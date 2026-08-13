use sqlx::PgPool;

/// Apply PostgreSQL schema (`migrations/*.sql` via sqlx; bundled rules in `001_schema.sql`).
pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("../migrations").run(pool).await?;
    Ok(())
}
