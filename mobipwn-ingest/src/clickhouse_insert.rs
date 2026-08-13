use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use clickhouse::Client;
use mobipwn_core::ch::EventRow;
use mobipwn_core::mudm::MudmEvent;
use tracing::info;

/// ClickHouse rejects inserts touching >100 daily partitions by default.
const MAX_PARTITION_DAYS_PER_INSERT: usize = 90;

pub async fn insert_events(client: &Client, events: &[MudmEvent]) -> anyhow::Result<usize> {
    insert_events_with_progress(client, events, None::<fn(usize, usize, usize)>).await
}

pub async fn insert_events_with_progress<F>(
    client: &Client,
    events: &[MudmEvent],
    mut on_batch: Option<F>,
) -> anyhow::Result<usize>
where
    F: FnMut(usize, usize, usize),
{
    if events.is_empty() {
        return Ok(0);
    }

    let batches = partition_batches(events);
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

/// Group row indices so each insert touches at most `MAX_PARTITION_DAYS_PER_INSERT` days.
fn partition_batches(events: &[MudmEvent]) -> Vec<Vec<usize>> {
    let mut by_day: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
    for (i, ev) in events.iter().enumerate() {
        let day = partition_day_key(ev.timestamp);
        by_day.entry(day).or_default().push(i);
    }

    let mut batches: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut days_in_batch = 0usize;

    for indices in by_day.into_values() {
        if days_in_batch >= MAX_PARTITION_DAYS_PER_INSERT && !current.is_empty() {
            batches.push(current);
            current = Vec::new();
            days_in_batch = 0;
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
