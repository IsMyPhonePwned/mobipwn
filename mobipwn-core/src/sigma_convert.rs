//! Convert Amnesty / sigma-zero YAML rules (website format) to mobipwn mPL detection queries.

use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct SigmaRuleFile {
    title: Option<String>,
    id: Option<String>,
    description: Option<String>,
    level: Option<String>,
    detection: Option<Value>,
}

/// mobipwn-dac rule YAML shape.
#[derive(Debug, Clone)]
pub struct ConvertedRule {
    pub name: String,
    pub description: String,
    pub query: String,
    pub severity: String,
    pub lifecycle: String,
    pub cron: Option<String>,
}

pub fn convert_rule_file(path: &Path) -> anyhow::Result<ConvertedRule> {
    let raw = std::fs::read_to_string(path)?;
    let doc: SigmaRuleFile = serde_yaml::from_str(&raw)?;
    let detection = doc
        .detection
        .as_ref()
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow::anyhow!("missing detection section"))?;
    let condition = detection
        .get("condition")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing detection.condition"))?;

    let mut selections = BTreeMap::new();
    for (key, val) in detection {
        if key == "condition" {
            continue;
        }
        if !val.is_object() {
            continue;
        }
        selections.insert(key.clone(), selection_to_mpl(val)?);
    }

    let query = condition_to_mpl(condition, &selections)?;
    let rule_id = doc.id.clone();
    let name = doc
        .title
        .filter(|s| !s.is_empty())
        .or(rule_id.clone())
        .unwrap_or_else(|| path.file_stem().unwrap().to_string_lossy().to_string());

    let mut description = doc.description.unwrap_or_default();
    if let Some(id) = &rule_id {
        if !description.contains(id) {
            if !description.is_empty() {
                description.push(' ');
            }
            description.push_str(&format!("(id: {id})"));
        }
    }

    let severity = map_level(doc.level.as_deref());

    Ok(ConvertedRule {
        name,
        description,
        query,
        severity,
        lifecycle: "staging".into(),
        cron: Some("0 */12 * * *".into()),
    })
}

fn map_level(level: Option<&str>) -> String {
    match level.unwrap_or("medium").to_lowercase().as_str() {
        "critical" => "critical",
        "high" => "high",
        "low" => "low",
        "informational" | "info" => "info",
        _ => "medium",
    }
    .to_string()
}

fn condition_to_mpl(condition: &str, selections: &BTreeMap<String, String>) -> anyhow::Result<String> {
    let lower = condition.to_lowercase();
    let parts: Vec<String> = if lower.contains(" or ") {
        lower
            .split(" or ")
            .map(|s| s.trim())
            .filter_map(|name| selections.get(name).cloned())
            .collect()
    } else if lower.contains(" and ") {
        lower
            .split(" and ")
            .map(|s| s.trim())
            .filter_map(|name| selections.get(name).cloned())
            .collect()
    } else {
        selections
            .get(condition.trim())
            .cloned()
            .into_iter()
            .collect()
    };

    if parts.is_empty() {
        anyhow::bail!("condition references unknown selections: {condition}");
    }

    let body = parts.join(" OR ");
    // No platform= filter: packs include Android, iOS, and mixed IoCs (e.g. Pegasus domains + com.apple.*).
    Ok(format!("({body}) | head 500"))
}

fn selection_to_mpl(sel: &Value) -> anyhow::Result<String> {
    let obj = sel.as_object().ok_or_else(|| anyhow::anyhow!("selection not an object"))?;
    let mut parts = Vec::new();
    for (key, val) in obj {
        let (field, contains) = parse_field_key(key);
        parts.push(field_values_to_mpl(&field, contains, val)?);
    }
    Ok(parts.join(" AND "))
}

fn parse_field_key(key: &str) -> (String, bool) {
    let (raw, contains) = if let Some((a, _)) = key.split_once("|contains") {
        (a, true)
    } else {
        (key, false)
    };
    let mpl = match raw {
        "pkg" | "package_name" => "bundle_id".to_string(),
        "remote_ip" => "dest_ip".to_string(),
        "destination_domain" => "destination_domain".to_string(),
        "process_name" => "process_name".to_string(),
        "file_path" => "file_path".to_string(),
        "file_hash" => "file_hash".to_string(),
        "email" => "email".to_string(),
        "function" => "function".to_string(),
        "event_type" => "data_type".to_string(),
        _ => raw.to_string(),
    };
    (mpl, contains)
}

fn field_values_to_mpl(field: &str, contains: bool, val: &Value) -> anyhow::Result<String> {
    match val {
        Value::String(s) => Ok(single_field_expr(field, contains, s)),
        Value::Array(arr) => {
            let exprs: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| single_field_expr(field, contains, s))
                .collect();
            if exprs.is_empty() {
                anyhow::bail!("empty array for field {field}");
            }
            Ok(format!("({})", exprs.join(" OR ")))
        }
        _ => anyhow::bail!("unsupported value for field {field}"),
    }
}

fn single_field_expr(field: &str, contains: bool, value: &str) -> String {
    let escaped = escape_mpl_string(value);
    if contains {
        if field == "process_name" && value.contains('.') {
            return format!(
                "(process_name=*{escaped}* OR bundle_id=*{escaped}*)"
            );
        }
        if field == "data_type" {
            return format!("data_type=*{escaped}*");
        }
        return format!("{field}=*{escaped}*");
    }
    if field == "data_type" {
        return format!("data_type=*{escaped}*");
    }
    if field == "destination_domain" {
        return format!(
            "(destination_domain=\"{escaped}\" OR dest_ip=\"{escaped}\" OR message=*{escaped}*)"
        );
    }
    if field == "file_path" {
        return format!(
            "(file_path=*{escaped}* OR message=*{escaped}* OR action=*{escaped}*)"
        );
    }
    format!("{field}=\"{escaped}\"")
}

fn escape_mpl_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn collect_rule_files(dir: &Path, skip_test: bool, out: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_rule_files(&path, skip_test, out)?;
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str());
            if matches!(ext, Some("yml") | Some("yaml")) {
                if !(skip_test && path.file_name().is_some_and(|n| n == "test.yml")) {
                    out.push(path);
                }
            }
        }
    }
    Ok(())
}

pub fn convert_rules_dir(input: &Path, skip_test: bool) -> anyhow::Result<Vec<(String, ConvertedRule)>> {
    let mut paths = Vec::new();
    collect_rule_files(input, skip_test, &mut paths)?;
    paths.sort();
    let mut out = Vec::new();
    for path in paths {
        let rule = convert_rule_file(&path)?;
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        out.push((stem, rule));
    }
    Ok(out)
}

pub fn write_dac_yaml(out_dir: &Path, stem: &str, rule: &ConvertedRule) -> anyhow::Result<()> {
    std::fs::create_dir_all(out_dir)?;
    let path = out_dir.join(format!("{stem}.yaml"));
    let yaml = format!(
        "name: {}\ndescription: |\n  {}\nquery: |\n  {}\nseverity: {}\nlifecycle: {}\ncron: \"{}\"\n",
        yaml_string(&rule.name),
        rule.description.replace('\n', "\n  "),
        rule.query.replace('\n', "\n  "),
        rule.severity,
        rule.lifecycle,
        rule.cron.as_deref().unwrap_or("0 */12 * * *"),
    );
    std::fs::write(path, yaml)?;
    Ok(())
}

fn yaml_string(s: &str) -> String {
    if s.contains(':') || s.contains('"') || s.contains('\n') {
        format!("{:?}", s)
    } else {
        s.to_string()
    }
}

pub fn write_rules_sql(path: &Path, rules: &[(String, ConvertedRule)]) -> anyhow::Result<()> {
    let mut sql = String::from(
        "-- Amnesty investigation rules converted from website/rules (sigma-zero → mPL)\n",
    );
    for (_stem, rule) in rules {
        let q = rule.query.replace('\'', "''");
        let name = rule.name.replace('\'', "''");
        let desc = rule.description.replace('\'', "''");
        sql.push_str(&format!(
            r#"INSERT INTO detection_rules (name, description, lifecycle, mode, query, cron, severity)
SELECT '{name}', '{desc}', 'staging', 'scheduled', '{q}', '{cron}', '{sev}'
WHERE NOT EXISTS (SELECT 1 FROM detection_rules WHERE name = '{name}');

"#,
            name = name,
            desc = desc,
            q = q,
            cron = rule.cron.as_deref().unwrap_or("0 */12 * * *"),
            sev = rule.severity,
        ));
    }
    std::fs::write(path, sql)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_domain_selection() {
        let det: Value = serde_yaml::from_str(
            r#"
selection_domain:
  destination_domain:
    - 'evil.com'
    - 'bad.net'
"#,
        )
        .unwrap();
        let sel = det.get("selection_domain").unwrap();
        let mpl = selection_to_mpl(sel).unwrap();
        assert!(mpl.contains("destination_domain=\"evil.com\""));
        assert!(mpl.contains("message=*bad.net*"));
    }
}
