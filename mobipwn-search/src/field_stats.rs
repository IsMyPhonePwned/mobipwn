use mobipwn_core::mudm::SEARCHABLE_FIELDS;

/// SQL for sidebar field statistics (top values + counts).
pub fn field_stats_sql(database: &str, field: &str, hours: u32, limit: u32) -> Option<String> {
    let value_expr = mobipwn_core::mudm::field_stats_value_sql(field)?;
    let has_value = mobipwn_core::mudm::field_has_value_sql(field)?;
    Some(format!(
        "SELECT {value_expr} AS value, count() AS cnt \
         FROM {database}.events \
         WHERE timestamp >= now() - INTERVAL {hours} HOUR AND {has_value} \
         GROUP BY {value_expr} ORDER BY cnt DESC LIMIT {limit}"
    ))
}

pub fn list_sidebar_fields() -> Vec<&'static str> {
    SEARCHABLE_FIELDS.iter().map(|f| f.name).collect()
}
