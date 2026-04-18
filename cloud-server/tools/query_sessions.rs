// Simple tool to query PostgreSQL sessions table
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/cc_island".to_string());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await?;

    println!("Querying sessions table...");

    let rows: Vec<(String, String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT device_token, session_id, project_name, status, current_tool FROM sessions ORDER BY updated_at DESC LIMIT 10"
    )
    .fetch_all(&pool)
    .await?;

    println!("Found {} sessions:");
    for (device, session, project, status, tool) in rows {
        println!("  device: {}, session: {}, project: {:?}, status: {}, tool: {:?}",
            device, session, project, status, tool);
    }

    Ok(())
}