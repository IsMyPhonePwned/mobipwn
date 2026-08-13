use sqlx::PgPool;
use uuid::Uuid;

/// Normalize a share token: lowercase, no dashes.
pub fn normalize_id_token(token: &str) -> String {
    token.trim().to_lowercase().replace('-', "")
}

fn try_parse_full_uuid(norm: &str) -> Option<Uuid> {
    if norm.len() != 32 || !norm.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let formatted = format!(
        "{}-{}-{}-{}-{}",
        &norm[0..8],
        &norm[8..12],
        &norm[12..16],
        &norm[16..20],
        &norm[20..32]
    );
    Uuid::parse_str(&formatted).ok()
}

/// Resolve a short or full UUID token against a table with a UUID `id` column.
pub async fn resolve_uuid_token(pool: &PgPool, table: &str, token: &str) -> anyhow::Result<Uuid> {
    let norm = normalize_id_token(token);
    if norm.is_empty() {
        anyhow::bail!("empty token");
    }
    if !norm.chars().all(|c| c.is_ascii_hexdigit()) {
        anyhow::bail!("invalid token");
    }
    if let Some(id) = try_parse_full_uuid(&norm) {
        return Ok(id);
    }
    if norm.len() < 8 {
        anyhow::bail!("token too short");
    }
    let sql = format!(
        "SELECT id FROM {table} WHERE replace(id::text, '-', '') LIKE $1 || '%' ORDER BY id LIMIT 2"
    );
    let rows: Vec<Uuid> = sqlx::query_scalar(&sql).bind(&norm).fetch_all(pool).await?;
    match rows.as_slice() {
        [] => anyhow::bail!("not found"),
        [id] => Ok(*id),
        _ => anyhow::bail!("ambiguous token — use a longer prefix"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_uuid_without_dashes() {
        let id = try_parse_full_uuid("550e8400e29b41d4a716446655440000").unwrap();
        assert_eq!(id.to_string(), "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn normalizes_tokens() {
        assert_eq!(
            normalize_id_token("550E8400-E29B-41D4"),
            "550e8400e29b41d4"
        );
    }
}
