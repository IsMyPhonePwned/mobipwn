use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityExtractConfig {
    pub default_limit: usize,
    pub process_limit: usize,
}

impl Default for EntityExtractConfig {
    fn default() -> Self {
        Self {
            default_limit: 50,
            process_limit: 500,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    User,
    Host,
    Bundle,
    Ip,
    Domain,
    Hash,
    Url,
    File,
    Process,
    Email,
}

impl EntityType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Host => "host",
            Self::Bundle => "bundle",
            Self::Ip => "ip",
            Self::Domain => "domain",
            Self::Hash => "hash",
            Self::Url => "url",
            Self::File => "file",
            Self::Process => "process",
            Self::Email => "email",
        }
    }

    /// Primary-entity preference (mobile: Host > Bundle > User > IP > Domain > Hash).
    pub fn primary_rank(self) -> u8 {
        match self {
            Self::Host => 0,
            Self::Bundle => 1,
            Self::User => 2,
            Self::Ip => 3,
            Self::Domain => 4,
            Self::Hash => 5,
            _ => 9,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedEntity {
    pub entity_type: EntityType,
    pub entity_value: String,
    pub occurrence_count: u64,
    pub is_primary: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrichment_data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityTypeSummary {
    pub entity_type: String,
    pub count: usize,
    pub entities: Vec<ExtractedEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimaryEntity {
    pub entity_type: String,
    pub entity_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityGraphNode {
    pub id: String,
    pub entity_type: String,
    pub label: String,
    pub occurrence_count: u64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityGraphEdge {
    pub source: String,
    pub target: String,
    pub weight: u64,
    /// Semantic link (e.g. on_host, connected_to) — not generic co-occurrence.
    pub relationship: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EntityGraph {
    pub nodes: Vec<EntityGraphNode>,
    pub edges: Vec<EntityGraphEdge>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct EntityKey {
    entity_type: EntityType,
    value: String,
}

impl EntityKey {
    fn id(&self) -> String {
        format!("{}:{}", self.entity_type.as_str(), self.value)
    }
}

/// Typed entity pairs observed in the same event (order-independent).
const RELATIONSHIP_RULES: &[(EntityType, EntityType, &str)] = &[
    (EntityType::Host, EntityType::Process, "on_host"),
    (EntityType::Host, EntityType::User, "on_host"),
    (EntityType::Host, EntityType::Ip, "network"),
    (EntityType::User, EntityType::Process, "executed"),
    (EntityType::Process, EntityType::Ip, "connected_to"),
    (EntityType::Process, EntityType::Hash, "executed"),
    (EntityType::Process, EntityType::File, "accessed"),
    (EntityType::Hash, EntityType::File, "hash_of"),
    (EntityType::Domain, EntityType::Ip, "resolved_to"),
    (EntityType::Url, EntityType::Domain, "belongs_to"),
    (EntityType::Email, EntityType::Domain, "belongs_to"),
    (EntityType::Process, EntityType::Domain, "connected_to"),
    (EntityType::Host, EntityType::Hash, "on_host"),
    (EntityType::Host, EntityType::File, "on_host"),
    (EntityType::Host, EntityType::Bundle, "on_host"),
    (EntityType::Process, EntityType::Bundle, "installed"),
    (EntityType::Bundle, EntityType::Ip, "connected_to"),
    (EntityType::Bundle, EntityType::Domain, "connected_to"),
    (EntityType::Bundle, EntityType::Hash, "executed"),
    (EntityType::Bundle, EntityType::File, "accessed"),
];

fn relationship_for_types(a: EntityType, b: EntityType) -> Option<&'static str> {
    RELATIONSHIP_RULES
        .iter()
        .find(|(ta, tb, _)| (*ta == a && *tb == b) || (*ta == b && *tb == a))
        .map(|(_, _, rel)| *rel)
}

pub fn extract_entities_from_events(
    rows: &[Value],
) -> (Vec<EntityTypeSummary>, EntityGraph, Option<PrimaryEntity>) {
    extract_entities_from_events_with_config(rows, &EntityExtractConfig::default())
}

pub fn extract_entities_from_events_with_config(
    rows: &[Value],
    cfg: &EntityExtractConfig,
) -> (Vec<EntityTypeSummary>, EntityGraph, Option<PrimaryEntity>) {
    let mut counts: HashMap<EntityKey, u64> = HashMap::new();
    let mut relationships: HashMap<(String, String, String), u64> = HashMap::new();

    for row in rows {
        let keys: Vec<EntityKey> = extract_from_event_row(row);
        for key in &keys {
            *counts.entry(key.clone()).or_insert(0) += 1;
        }
        for i in 0..keys.len() {
            for j in (i + 1)..keys.len() {
                let Some(relationship) = relationship_for_types(keys[i].entity_type, keys[j].entity_type) else {
                    continue;
                };
                let (source, target) = ordered_edge_ids(&keys[i], &keys[j]);
                let key = (source, target, relationship.to_string());
                *relationships.entry(key).or_insert(0) += 1;
            }
        }
        add_process_parent_edge(row, &mut relationships);
    }

    let primary = select_primary_entity(&counts);
    let mut by_type: HashMap<EntityType, Vec<ExtractedEntity>> = HashMap::new();
    for (key, count) in counts {
        let is_primary = primary
            .as_ref()
            .is_some_and(|p| p.entity_type == key.entity_type.as_str() && p.entity_value == key.value);
        by_type
            .entry(key.entity_type)
            .or_default()
            .push(ExtractedEntity {
                entity_type: key.entity_type,
                entity_value: key.value,
                occurrence_count: count,
                is_primary,
                risk_score: None,
                enrichment_data: None,
            });
    }

    let mut summaries = Vec::new();
    let type_order = [
        EntityType::User,
        EntityType::Host,
        EntityType::Bundle,
        EntityType::Ip,
        EntityType::Domain,
        EntityType::Hash,
        EntityType::Url,
        EntityType::File,
        EntityType::Process,
        EntityType::Email,
    ];

    for entity_type in type_order {
        let Some(mut entities) = by_type.remove(&entity_type) else {
            continue;
        };
        entities.sort_by(|a, b| b.occurrence_count.cmp(&a.occurrence_count));
        let cap = if entity_type == EntityType::Process {
            cfg.process_limit
        } else {
            cfg.default_limit
        };
        if entities.len() > cap {
            entities.truncate(cap);
        }
        summaries.push(EntityTypeSummary {
            count: entities.len(),
            entity_type: entity_type.as_str().to_string(),
            entities,
        });
    }

    let mut nodes = Vec::new();
    for summary in &summaries {
        for e in &summary.entities {
            nodes.push(EntityGraphNode {
                id: format!("{}:{}", e.entity_type.as_str(), e.entity_value),
                entity_type: e.entity_type.as_str().to_string(),
                label: e.entity_value.clone(),
                occurrence_count: e.occurrence_count,
                is_primary: e.is_primary,
            });
        }
    }

    let node_ids: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let mut edges: Vec<EntityGraphEdge> = relationships
        .into_iter()
        .filter(|((a, b, _), _)| node_ids.contains(a) && node_ids.contains(b))
        .map(|((source, target, relationship), weight)| EntityGraphEdge {
            source,
            target,
            weight,
            relationship,
        })
        .collect();
    edges.sort_by(|a, b| b.weight.cmp(&a.weight));
    if edges.len() > 200 {
        edges.truncate(200);
    }

    let graph = EntityGraph { nodes, edges };
    (summaries, graph, primary)
}

fn entity_matches_primary(entity_type: &str, entity_value: &str, primary: &PrimaryEntity) -> bool {
    entity_type == primary.entity_type && entity_value == primary.entity_value
}

/// Apply a stored case anchor override and refresh `is_primary` markers on entities/graph nodes.
pub fn apply_primary_anchor(
    mut response: crate::entities::CaseEntitiesResponse,
    anchor: Option<&PrimaryEntity>,
) -> crate::entities::CaseEntitiesResponse {
    let auto = response.primary_entity.clone();
    response.auto_primary_entity = auto.clone();

    let (effective, source) = match anchor {
        Some(p) => (Some(p.clone()), "manual"),
        None => (auto, "auto"),
    };

    if let Some(ref primary) = effective {
        for summary in &mut response.entities {
            for entity in &mut summary.entities {
                entity.is_primary =
                    entity_matches_primary(entity.entity_type.as_str(), &entity.entity_value, primary);
            }
        }
        for node in &mut response.graph.nodes {
            node.is_primary = entity_matches_primary(&node.entity_type, &node.label, primary);
        }
    } else {
        for summary in &mut response.entities {
            for entity in &mut summary.entities {
                entity.is_primary = false;
            }
        }
        for node in &mut response.graph.nodes {
            node.is_primary = false;
        }
    }

    response.primary_entity = effective;
    response.primary_entity_source = source.to_string();
    response
}

pub fn entity_exists_in_response(response: &crate::entities::CaseEntitiesResponse, primary: &PrimaryEntity) -> bool {
    response.entities.iter().any(|group| {
        group.entities.iter().any(|e| {
            entity_matches_primary(e.entity_type.as_str(), &e.entity_value, primary)
        })
    })
}

fn ordered_edge_ids(a: &EntityKey, b: &EntityKey) -> (String, String) {
    let id_a = a.id();
    let id_b = b.id();
    if id_a < id_b {
        (id_a, id_b)
    } else {
        (id_b, id_a)
    }
}

fn select_primary_entity(counts: &HashMap<EntityKey, u64>) -> Option<PrimaryEntity> {
    counts
        .iter()
        .filter(|(k, c)| **c > 0 && k.entity_type.primary_rank() <= 5)
        .min_by(|(ka, ca), (kb, cb)| {
            ka.entity_type
                .primary_rank()
                .cmp(&kb.entity_type.primary_rank())
                .then_with(|| cb.cmp(ca))
                .then_with(|| ka.value.cmp(&kb.value))
        })
        .map(|(k, _)| PrimaryEntity {
            entity_type: k.entity_type.as_str().to_string(),
            entity_value: k.value.clone(),
        })
}

fn extract_from_event_row(row: &Value) -> Vec<EntityKey> {
    let mut out = Vec::new();
    let ext = parse_ext(row.get("ext"));

    add_value(&mut out, EntityType::User, str_field(row, "user"));
    add_value(&mut out, EntityType::User, ext_str(&ext, "user"));
    add_value(&mut out, EntityType::User, ext_str(&ext, "src_user"));
    add_value(&mut out, EntityType::User, ext_str(&ext, "dest_user"));

    let host = str_field(row, "device_id")
        .or_else(|| str_field(row, "device_model"))
        .or_else(|| ext_str(&ext, "serial"));
    add_value(&mut out, EntityType::Host, host);

    add_value(&mut out, EntityType::Bundle, str_field(row, "bundle_id"));
    add_value(&mut out, EntityType::Bundle, ext_str(&ext, "bundle_id"));
    add_value(&mut out, EntityType::Bundle, ext_str(&ext, "package_name"));
    add_value(&mut out, EntityType::Bundle, ext_str(&ext, "pkg"));

    add_value(&mut out, EntityType::Ip, str_field(row, "src_ip"));
    add_value(&mut out, EntityType::Ip, str_field(row, "dest_ip"));
    add_value(&mut out, EntityType::Ip, ext_str(&ext, "remote_ip"));
    add_value(&mut out, EntityType::Ip, ext_str(&ext, "peer_ip"));

    add_value(&mut out, EntityType::Domain, str_field(row, "destination_domain"));
    add_value(&mut out, EntityType::Domain, ext_str(&ext, "destination_domain"));
    add_value(&mut out, EntityType::Domain, ext_str(&ext, "url_domain"));
    add_value(&mut out, EntityType::Domain, ext_str(&ext, "sender_domain"));
    add_value(&mut out, EntityType::Domain, ext_str(&ext, "recipient_domain"));

    add_value(&mut out, EntityType::Hash, str_field(row, "file_hash"));
    add_value(&mut out, EntityType::Hash, ext_str(&ext, "process_hash"));

    add_value(&mut out, EntityType::Url, ext_str(&ext, "url"));
    add_value(&mut out, EntityType::File, ext_str(&ext, "file_path"));
    add_value(&mut out, EntityType::File, ext_str(&ext, "file_name"));
    add_value(&mut out, EntityType::File, ext_str(&ext, "process_path"));
    add_value(
        &mut out,
        EntityType::Process,
        str_field(row, "process_name"),
    );
    add_value(
        &mut out,
        EntityType::Process,
        ext_str(&ext, "parent_process_name").or_else(|| parent_process_name(&ext)),
    );
    add_value(&mut out, EntityType::Email, ext_str(&ext, "email"));
    add_value(&mut out, EntityType::Email, ext_str(&ext, "sender"));
    add_value(&mut out, EntityType::Email, ext_str(&ext, "recipient"));

    let mut string_values = Vec::new();
    collect_strings(row, &mut string_values);
    collect_strings(&ext, &mut string_values);

    for text in string_values {
        for ip in extract_public_ips(&text) {
            add_value(&mut out, EntityType::Ip, Some(ip));
        }
        for url in extract_urls(&text) {
            add_value(&mut out, EntityType::Url, Some(url));
        }
        for hash in extract_hashes(&text) {
            add_value(&mut out, EntityType::Hash, Some(hash));
        }
        for email in extract_emails(&text) {
            add_value(&mut out, EntityType::Email, Some(email));
        }
    }

    dedupe_keys(out)
}

fn add_process_parent_edge(
    row: &Value,
    relationships: &mut HashMap<(String, String, String), u64>,
) {
    let ext = parse_ext(row.get("ext"));
    let Some(child) = normalize_value(EntityType::Process, str_field(row, "process_name")) else {
        return;
    };
    let Some(parent) = normalize_value(
        EntityType::Process,
        ext_str(&ext, "parent_process_name").or_else(|| parent_process_name(&ext)),
    ) else {
        return;
    };
    if child == parent {
        return;
    }
    let key = (
        format!("process:{child}"),
        format!("process:{parent}"),
        "child_of".to_string(),
    );
    *relationships.entry(key).or_insert(0) += 1;
}

fn parent_process_name(ext: &Value) -> Option<String> {
    let raw = ext_str(ext, "parent")?;
    let trimmed = raw.trim().trim_matches('"');
    if let Some(start) = trimmed.rfind(" [") {
        if trimmed.ends_with(']')
            && trimmed[start + 2..trimmed.len() - 1]
                .chars()
                .all(|c| c.is_ascii_digit())
        {
            return Some(trimmed[..start].to_string());
        }
    }
    Some(trimmed.to_string())
}

fn add_value(out: &mut Vec<EntityKey>, entity_type: EntityType, value: Option<String>) {
    let Some(value) = normalize_value(entity_type, value) else {
        return;
    };
    out.push(EntityKey {
        entity_type,
        value,
    });
}

fn normalize_value(entity_type: EntityType, value: Option<String>) -> Option<String> {
    let v = value?.trim().to_string();
    if v.is_empty() {
        return None;
    }
    match entity_type {
        EntityType::Ip => normalize_ip_value(&v),
        EntityType::Domain => {
            if looks_like_ip(&v) || v.contains('/') {
                None
            } else {
                Some(v.to_lowercase())
            }
        }
        EntityType::Hash => Some(v.to_lowercase()),
        EntityType::Email => Some(v.to_lowercase()),
        EntityType::Url => Some(v),
        EntityType::Bundle => normalize_bundle(&v),
        _ => Some(v),
    }
}

fn normalize_bundle(v: &str) -> Option<String> {
    let v = v.trim();
    if v.is_empty() || v == "null" || v == "system" || v == "android" {
        return None;
    }
    Some(v.to_string())
}

fn dedupe_keys(keys: Vec<EntityKey>) -> Vec<EntityKey> {
    let mut seen = HashSet::new();
    keys.into_iter()
        .filter(|k| seen.insert(k.clone()))
        .collect()
}

fn str_field(row: &Value, name: &str) -> Option<String> {
    row.get(name)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_ext(v: Option<&Value>) -> Value {
    match v {
        Some(Value::Object(o)) => Value::Object(o.clone()),
        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Object(Default::default())),
        _ => Value::Object(Default::default()),
    }
}

fn ext_str(ext: &Value, key: &str) -> Option<String> {
    ext.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn collect_strings(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) if !s.is_empty() => out.push(s.clone()),
        Value::Array(items) => {
            for item in items {
                collect_strings(item, out);
            }
        }
        Value::Object(map) => {
            for val in map.values() {
                collect_strings(val, out);
            }
        }
        _ => {}
    }
}

fn normalize_ip_value(v: &str) -> Option<String> {
    let s = crate::net::ip_resolve::strip_ip_zone(v);
    if s.is_empty() {
        return None;
    }
    if let Ok(ip) = s.parse::<IpAddr>() {
        return Some(ip.to_string());
    }
    parse_ipv4_dotted(s).map(str::to_string)
}

fn parse_ipv4_dotted(s: &str) -> Option<&str> {
    let s = s.trim();
    if s.chars().all(|c| c.is_ascii_digit() || c == '.') {
        let parts: Vec<_> = s.split('.').collect();
        if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
            return Some(s);
        }
    }
    None
}

fn looks_like_ip(s: &str) -> bool {
    normalize_ip_value(s).is_some()
}

fn is_private_ip(ip: &str) -> bool {
    let parts: Vec<u8> = ip.split('.').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 4 {
        return false;
    }
    match parts[0] {
        10 => true,
        127 => true,
        0 => true,
        169 if parts[1] == 254 => true,
        172 if (16..=31).contains(&parts[1]) => true,
        192 if parts[1] == 168 => true,
        _ => false,
    }
}

fn extract_public_ips(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").expect("ip regex"));
    re.find_iter(text)
        .filter_map(|m| parse_ipv4_dotted(m.as_str()))
        .filter(|ip| !is_private_ip(ip))
        .map(str::to_string)
        .collect()
}

fn extract_urls(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"https?://[^\s<>"']+"#).expect("url regex"));
    re.find_iter(text).map(|m| m.as_str().to_string()).collect()
}

fn extract_hashes(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\b[a-fA-F0-9]{32,64}\b").expect("hash regex"));
    let mut seen = HashSet::new();
    re.find_iter(text)
        .map(|m| m.as_str().to_lowercase())
        .filter(|h| seen.insert(h.clone()))
        .collect()
}

fn extract_emails(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").expect("email regex")
    });
    re.find_iter(text)
        .map(|m| m.as_str().to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_udm_fields_and_regex_ips() {
        let row = json!({
            "user": "jsmith",
            "device_id": "LAPTOP-ABC123",
            "dest_ip": "10.0.0.5",
            "message": "Outbound connection to 203.0.113.42 evil",
            "ext": {
                "destination_domain": "evil.com",
                "email": "admin@example.com"
            }
        });
        let keys = extract_from_event_row(&row);
        assert!(keys.iter().any(|k| k.entity_type == EntityType::User && k.value == "jsmith"));
        assert!(keys.iter().any(|k| k.entity_type == EntityType::Host));
        assert!(keys.iter().any(|k| k.entity_type == EntityType::Ip && k.value == "10.0.0.5"));
        assert!(keys.iter().any(|k| k.entity_type == EntityType::Ip && k.value == "203.0.113.42"));
        assert!(keys.iter().any(|k| k.entity_type == EntityType::Domain && k.value == "evil.com"));
    }

    #[test]
    fn builds_typed_relationships_not_all_pairs() {
        let rows = vec![json!({
            "device_id": "PHONE-1",
            "process_name": "com.evil.app",
            "dest_ip": "203.0.113.9",
            "file_hash": "abcd1234abcd1234abcd1234abcd1234",
        })];
        let (_, graph, _) = extract_entities_from_events(&rows);
        assert!(graph.edges.iter().any(|e| e.relationship == "on_host"));
        assert!(graph.edges.iter().any(|e| e.relationship == "connected_to"));
        assert!(graph.edges.iter().any(|e| e.relationship == "executed"));
        // No spurious hash↔ip edge (no rule).
        assert!(
            !graph.edges.iter().any(|e| {
                (e.source.contains("hash:") && e.target.contains("ip:"))
                    || (e.source.contains("ip:") && e.target.contains("hash:"))
            })
        );
    }

    #[test]
    fn extracts_bundle_id_from_row() {
        let row = json!({
            "device_id": "PHONE-1",
            "bundle_id": "com.evil.app",
            "process_name": "com.evil.app",
        });
        let keys = extract_from_event_row(&row);
        assert!(keys.iter().any(|k| k.entity_type == EntityType::Bundle && k.value == "com.evil.app"));
    }

    #[test]
    fn bundle_host_relationship() {
        let rows = vec![json!({
            "device_id": "PHONE-1",
            "bundle_id": "com.evil.app",
        })];
        let (_, graph, _) = extract_entities_from_events(&rows);
        assert!(graph.edges.iter().any(|e| e.relationship == "on_host"));
    }

    #[test]
    fn primary_prefers_host_over_user() {
        let mut counts = HashMap::new();
        counts.insert(
            EntityKey {
                entity_type: EntityType::User,
                value: "admin".into(),
            },
            20,
        );
        counts.insert(
            EntityKey {
                entity_type: EntityType::Host,
                value: "SRV-01".into(),
            },
            3,
        );
        let primary = select_primary_entity(&counts).unwrap();
        assert_eq!(primary.entity_type, "host");
        assert_eq!(primary.entity_value, "SRV-01");
    }

    #[test]
    fn extracts_ipv6_dest_ip() {
        let row = json!({
            "dest_ip": "2001:4860:4860::8888",
        });
        let keys = extract_from_event_row(&row);
        assert!(keys.iter().any(|k| {
            k.entity_type == EntityType::Ip && k.value == "2001:4860:4860::8888"
        }));
    }

    #[test]
    fn respects_configured_process_limit() {
        let rows: Vec<Value> = (0..3)
            .map(|i| {
                json!({
                    "process_name": format!("proc-{i}"),
                })
            })
            .collect();
        let (summaries, _, _) = extract_entities_from_events_with_config(
            &rows,
            &EntityExtractConfig {
                default_limit: 50,
                process_limit: 2,
            },
        );
        let process_summary = summaries
            .iter()
            .find(|s| s.entity_type == "process")
            .expect("process summary");
        assert_eq!(process_summary.count, 2);
        assert_eq!(process_summary.entities.len(), 2);
    }

    #[test]
    fn links_child_process_to_parent_process() {
        let rows = vec![json!({
            "process_name": "zsh",
            "ext": {
                "parent": "sshd [298]",
                "ppid": 298
            }
        })];
        let (summaries, graph, _) = extract_entities_from_events(&rows);
        let process_summary = summaries
            .iter()
            .find(|s| s.entity_type == "process")
            .expect("process summary");
        assert!(process_summary.entities.iter().any(|e| e.entity_value == "zsh"));
        assert!(process_summary.entities.iter().any(|e| e.entity_value == "sshd"));
        assert!(graph.edges.iter().any(|e| {
            e.source == "process:zsh" && e.target == "process:sshd" && e.relationship == "child_of"
        }));
    }
}
