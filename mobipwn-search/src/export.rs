use serde_json::Value;

pub enum ExportFormat {
    Csv,
    Jsonl,
}

impl ExportFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "csv" => Some(Self::Csv),
            "jsonl" | "ndjson" => Some(Self::Jsonl),
            _ => None,
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Csv => "text/csv; charset=utf-8",
            Self::Jsonl => "application/x-ndjson",
        }
    }

    pub fn file_extension(&self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Jsonl => "jsonl",
        }
    }
}

pub fn rows_to_jsonl(rows: &[Value]) -> String {
    let mut out = String::new();
    for row in rows {
        out.push_str(&serde_json::to_string(row).unwrap_or_else(|_| "{}".into()));
        out.push('\n');
    }
    out
}

fn csv_cell(value: &Value) -> String {
    let s = match value {
        Value::Null => String::new(),
        Value::String(v) => v.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    };
    let needs_quote = s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r');
    if needs_quote {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

pub fn rows_to_csv(columns: &[String], rows: &[Value]) -> String {
    let mut out = String::new();
    out.push_str(&columns.join(","));
    out.push('\n');
    for row in rows {
        let line = columns
            .iter()
            .map(|col| csv_cell(row.get(col).unwrap_or(&Value::Null)))
            .collect::<Vec<_>>()
            .join(",");
        out.push_str(&line);
        out.push('\n');
    }
    out
}

pub fn format_rows(columns: &[String], rows: &[Value], format: ExportFormat) -> String {
    match format {
        ExportFormat::Csv => rows_to_csv(columns, rows),
        ExportFormat::Jsonl => rows_to_jsonl(rows),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn csv_quotes_commas() {
        let cols = vec!["a".into(), "b".into()];
        let rows = vec![json!({"a": "x,y", "b": 1})];
        let csv = rows_to_csv(&cols, &rows);
        assert!(csv.contains("\"x,y\""));
    }

    #[test]
    fn jsonl_one_line_per_row() {
        let rows = vec![json!({"id": 1}), json!({"id": 2})];
        assert_eq!(rows_to_jsonl(&rows).lines().count(), 2);
    }
}
