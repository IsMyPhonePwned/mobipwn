use super::EnrichmentProvider;
use crate::mudm::MudmEvent;

/// Fraction of populated MUDM fields that have at least one enabled provider.
pub fn coverage_for_event(event: &MudmEvent, providers: &[EnrichmentProvider]) -> f64 {
    let enabled: Vec<_> = providers.iter().filter(|p| p.enabled).collect();
    if enabled.is_empty() {
        return 0.0;
    }

    let candidates = [
        ("src_ip", !event.src_ip.is_empty()),
        ("dest_ip", !event.dest_ip.is_empty()),
        ("file_hash", !event.file_hash.is_empty()),
        ("bundle_id", !event.bundle_id.is_empty()),
        ("device_id", !event.device_id.is_empty()),
        ("ssid", !event.ssid.is_empty()),
    ];

    let populated: Vec<_> = candidates
        .iter()
        .filter(|(_, has)| *has)
        .map(|(f, _)| *f)
        .collect();
    if populated.is_empty() {
        return 0.0;
    }

    let covered = populated
        .iter()
        .filter(|field| {
            enabled.iter().any(|p| p.covers_fields.iter().any(|c| c == *field))
        })
        .count();

    covered as f64 / populated.len() as f64
}

/// Marketplace UI: percent of enrichable MUDM slots covered by enabled providers.
pub fn coverage_percent(covered_field_count: usize) -> f64 {
    const ENRICHABLE: f64 = 8.0;
    ((covered_field_count as f64 / ENRICHABLE) * 100.0).min(100.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::marketplace::ProviderKind;
    use chrono::Utc;

    fn provider(slug: &str, fields: &[&str], enabled: bool) -> EnrichmentProvider {
        EnrichmentProvider {
            id: uuid::Uuid::nil(),
            slug: slug.into(),
            name: slug.into(),
            kind: ProviderKind::ThreatIntel,
            enabled,
            covers_fields: fields.iter().map(|s| s.to_string()).collect(),
            config: serde_json::json!({}),
            last_sync_at: None,
            last_sync_status: None,
            last_sync_error: None,
            enriched_field_count: 0,
            enriched_fields: vec![],
        }
    }

    fn event_with(fields: impl FnOnce(&mut MudmEvent)) -> MudmEvent {
        let mut e = MudmEvent::new(Utc::now(), "test");
        fields(&mut e);
        e
    }

    #[test]
    fn coverage_percent_caps_at_100() {
        assert!((coverage_percent(4) - 50.0).abs() < f64::EPSILON);
        assert_eq!(coverage_percent(100), 100.0);
    }

    #[test]
    fn coverage_for_event_with_no_enabled_providers() {
        let event = event_with(|e| e.src_ip = "8.8.8.8".into());
        let providers = vec![provider("geo_lite", &["src_ip"], false)];
        assert_eq!(coverage_for_event(&event, &providers), 0.0);
    }

    #[test]
    fn coverage_for_event_counts_populated_fields() {
        let event = event_with(|e| {
            e.src_ip = "8.8.8.8".into();
            e.dest_ip = "1.1.1.1".into();
        });
        let providers = vec![provider("geo_lite", &["src_ip", "dest_ip"], true)];
        assert!((coverage_for_event(&event, &providers) - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn coverage_for_event_partial_when_only_one_field_covered() {
        let event = event_with(|e| {
            e.src_ip = "8.8.8.8".into();
            e.file_hash = "abc".into();
        });
        let providers = vec![provider("geo_lite", &["src_ip"], true)];
        assert!((coverage_for_event(&event, &providers) - 0.5).abs() < f64::EPSILON);
    }
}
