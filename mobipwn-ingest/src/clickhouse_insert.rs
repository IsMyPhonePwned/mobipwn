use std::collections::BTreeMap;
use std::path::Path;

use chrono::{DateTime, Utc};
use clickhouse::Client;
use mobipwn_core::ch::EventRow;
use mobipwn_core::mudm::{normalize_timeline_line, MudmEvent, TimelinePlatform};
use tracing::info;

/// ClickHouse rejects inserts touching >100 daily partitions by default.
const MAX_PARTITION_DAYS_PER_INSERT: usize = 90;

/// Default rows per insert when streaming/draining (overridable via ingest pool settings).
pub const DEFAULT_INSERT_CHUNK_SIZE: usize = 25_000;

pub async fn insert_events(client: &Client, events: &[MudmEvent]) -> anyhow::Result<usize> {
    insert_events_with_progress(client, events, None::<fn(usize, usize, usize)>).await
}

pub async fn insert_events_with_progress<F>(
    client: &Client,
    events: &[MudmEvent],
    on_batch: Option<F>,
) -> anyhow::Result<usize>
where
    F: FnMut(usize, usize, usize),
{
    // Preserve prior behavior: day-based batches only (no artificial row split).
    insert_events_chunked(client, events, usize::MAX / 4, on_batch).await
}

/// Insert events in bounded row chunks (and ≤90 partition-days per insert).
pub async fn insert_events_chunked<F>(
    client: &Client,
    events: &[MudmEvent],
    chunk_size: usize,
    mut on_batch: Option<F>,
) -> anyhow::Result<usize>
where
    F: FnMut(usize, usize, usize),
{
    if events.is_empty() {
        return Ok(0);
    }

    let chunk_size = chunk_size.clamp(1, 500_000);
    let batches = partition_batches(events, chunk_size);
    let mut total = 0usize;
    for (batch_idx, indices) in batches.iter().enumerate() {
        let n = indices.len();
        insert_batch(client, events, indices).await?;
        total += n;
        if let Some(ref mut hook) = on_batch {
            hook(batch_idx + 1, batches.len(), total);
        }
        if batches.len() > 1 {
            info!(
                batch = batch_idx + 1,
                batches = batches.len(),
                rows = n,
                "inserted event batch into ClickHouse"
            );
        }
    }
    info!(count = total, "inserted events into ClickHouse");
    Ok(total)
}

/// Drain `events` in chunks so peak RAM falls as insert progresses.
pub async fn insert_events_draining<F>(
    client: &Client,
    events: &mut Vec<MudmEvent>,
    chunk_size: usize,
    mut on_batch: Option<F>,
) -> anyhow::Result<usize>
where
    F: FnMut(usize, usize, usize),
{
    if events.is_empty() {
        return Ok(0);
    }
    let chunk_size = chunk_size.clamp(1_000, 500_000);
    let total_events = events.len();
    let approx_batches = total_events.div_ceil(chunk_size).max(1);
    let mut total = 0usize;
    let mut batch_idx = 0usize;

    while !events.is_empty() {
        let take = events.len().min(chunk_size);
        let chunk: Vec<MudmEvent> = events.drain(..take).collect();
        batch_idx += 1;
        let n = insert_events_chunked(
            client,
            &chunk,
            chunk.len().max(1),
            None::<fn(usize, usize, usize)>,
        )
        .await?;
        total += n;
        if let Some(ref mut hook) = on_batch {
            hook(batch_idx, approx_batches.max(batch_idx), total);
        }
        drop(chunk);
    }
    info!(count = total, "inserted events into ClickHouse (draining)");
    Ok(total)
}

/// Stream a JSONL timeline file into ClickHouse without building a full `Vec<MudmEvent>`.
pub async fn insert_jsonl_file_chunked<F>(
    client: &Client,
    path: &Path,
    platform: TimelinePlatform,
    source_label: &str,
    chunk_size: usize,
    mut on_batch: Option<F>,
) -> anyhow::Result<usize>
where
    F: FnMut(usize, usize, usize),
{
    use std::io::{BufRead, BufReader};

    let chunk_size = chunk_size.clamp(1_000, 500_000);
    let file = std::fs::File::open(path)
        .map_err(|e| anyhow::anyhow!("open jsonl {}: {e}", path.display()))?;
    let reader = BufReader::new(file);
    let mut chunk: Vec<MudmEvent> = Vec::with_capacity(chunk_size.min(8_192));
    let mut total = 0usize;
    let mut batch_idx = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|e| anyhow::anyhow!("read jsonl: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(ev) = normalize_timeline_line(&v, platform, source_label) else {
            continue;
        };
        chunk.push(ev);
        if chunk.len() >= chunk_size {
            batch_idx += 1;
            let n = insert_events_chunked(
                client,
                &chunk,
                chunk.len(),
                None::<fn(usize, usize, usize)>,
            )
            .await?;
            total += n;
            if let Some(ref mut hook) = on_batch {
                hook(batch_idx, batch_idx, total);
            }
            chunk.clear();
        }
    }

    if !chunk.is_empty() {
        batch_idx += 1;
        let n = insert_events_chunked(
            client,
            &chunk,
            chunk.len(),
            None::<fn(usize, usize, usize)>,
        )
        .await?;
        total += n;
        if let Some(ref mut hook) = on_batch {
            hook(batch_idx, batch_idx, total);
        }
    }

    info!(count = total, path = %path.display(), "inserted jsonl file into ClickHouse");
    Ok(total)
}

/// Group row indices so each insert touches at most `MAX_PARTITION_DAYS_PER_INSERT` days
/// and at most `max_rows` events.
pub(crate) fn partition_batches(events: &[MudmEvent], max_rows: usize) -> Vec<Vec<usize>> {
    let mut by_day: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
    for (i, ev) in events.iter().enumerate() {
        let day = partition_day_key(ev.timestamp);
        by_day.entry(day).or_default().push(i);
    }

    let mut batches: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut days_in_batch = 0usize;

    for indices in by_day.into_values() {
        if (days_in_batch >= MAX_PARTITION_DAYS_PER_INSERT
            || (!current.is_empty() && current.len() + indices.len() > max_rows))
            && !current.is_empty()
        {
            batches.push(std::mem::take(&mut current));
            days_in_batch = 0;
        }

        if indices.len() > max_rows {
            if !current.is_empty() {
                batches.push(std::mem::take(&mut current));
                days_in_batch = 0;
            }
            for chunk in indices.chunks(max_rows) {
                batches.push(chunk.to_vec());
            }
            continue;
        }

        current.extend(indices);
        days_in_batch += 1;
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

fn partition_day_key(ts: DateTime<Utc>) -> i32 {
    ts.format("%Y%m%d")
        .to_string()
        .parse()
        .unwrap_or(0)
}

async fn insert_batch(
    client: &Client,
    events: &[MudmEvent],
    indices: &[usize],
) -> anyhow::Result<()> {
    let ingest_time = Utc::now();
    let mut insert = client.insert::<EventRow>("events").await?;
    for &i in indices {
        let ev = &events[i];
        insert.write(&event_row(ev, ingest_time)).await?;
    }
    insert.end().await?;
    Ok(())
}

fn event_row(ev: &MudmEvent, ingest_time: DateTime<Utc>) -> EventRow {
    EventRow {
        id: ev.id,
        timestamp: ev.timestamp,
        message: ev.message.clone(),
        source_type: ev.source_type.clone(),
        source: ev.source.clone(),
        ingest_time,
        platform: ev.platform.clone(),
        device_id: ev.device_id.clone(),
        device_model: ev.device_model.clone(),
        os_version: ev.os_version.clone(),
        bundle_id: ev.bundle_id.clone(),
        app_name: ev.app_name.clone(),
        parser: ev.parser.clone(),
        data_type: ev.data_type.clone(),
        event_time_binding: ev.event_time_binding.clone(),
        process_name: ev.process_name.clone(),
        process_id: ev.process_id,
        user: ev.user.clone(),
        src_ip: ev.src_ip.clone(),
        dest_ip: ev.dest_ip.clone(),
        ssid: ev.ssid.clone(),
        permission: ev.permission.clone(),
        file_hash: ev.file_hash.clone(),
        severity: ev.severity.clone(),
        action: ev.action.clone(),
        ext: ev.ext.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn ev_on_day(year: i32, month: u32, day: u32) -> MudmEvent {
        let ts = Utc
            .with_ymd_and_hms(year, month, day, 12, 0, 0)
            .single()
            .expect("valid date");
        MudmEvent::new(ts, "test")
    }

    #[test]
    fn partition_batches_empty() {
        assert!(partition_batches(&[], 100).is_empty());
    }

    #[test]
    fn partition_batches_splits_by_row_cap() {
        let events: Vec<_> = (0..5).map(|_| ev_on_day(2026, 1, 1)).collect();
        let batches = partition_batches(&events, 2);
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0].len(), 2);
        assert_eq!(batches[1].len(), 2);
        assert_eq!(batches[2].len(), 1);
        let covered: usize = batches.iter().map(|b| b.len()).sum();
        assert_eq!(covered, 5);
    }

    #[test]
    fn partition_batches_groups_same_day_until_row_cap() {
        let events = vec![ev_on_day(2026, 1, 1), ev_on_day(2026, 1, 1), ev_on_day(2026, 1, 2)];
        let batches = partition_batches(&events, 10);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].len(), 3);
    }

    #[test]
    fn partition_batches_splits_across_many_days() {
        // 3 days with max_rows large — still one batch while days < 90
        let events: Vec<_> = (1..=3).map(|d| ev_on_day(2026, 1, d)).collect();
        let batches = partition_batches(&events, 10_000);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].len(), 3);
    }

    #[test]
    fn partition_batches_respects_day_cap() {
        let events: Vec<_> = (1..=5).map(|d| ev_on_day(2024, 1, d)).collect();
        let batches = partition_batches(&events, 10_000);
        // 5 days << 90 → single batch
        assert_eq!(batches.len(), 1);

        // With max_rows=1 each day becomes its own batch.
        let tight = partition_batches(&events, 1);
        assert_eq!(tight.len(), 5);
    }

    #[test]
    fn partition_batches_splits_when_crossing_ninety_days() {
        let events: Vec<_> = (0..95)
            .map(|i| {
                let day = Utc
                    .with_ymd_and_hms(2024, 1, 1, 0, 0, 0)
                    .single()
                    .unwrap()
                    + chrono::Duration::days(i);
                MudmEvent::new(day, "d")
            })
            .collect();
        let batches = partition_batches(&events, 10_000);
        assert!(batches.len() >= 2, "expected split after 90 partition days, got {}", batches.len());
        let covered: usize = batches.iter().map(|b| b.len()).sum();
        assert_eq!(covered, 95);
        assert!(batches.iter().all(|b| b.len() <= 90));
    }
}
