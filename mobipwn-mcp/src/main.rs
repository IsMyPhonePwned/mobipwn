mod api;
mod handler;

use anyhow::Result;
use clap::Parser;
use handler::{MobiPwnMcp, INSTRUCTIONS};
use rmcp::{ServiceExt, transport::stdio};
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Parser)]
#[command(
    name = "mobipwn-mcp",
    about = "MobiPwn MCP server — hunt, triage, and detection-as-code for external LLM agents"
)]
struct Cli {
    #[arg(long, env = "MOBIPWN_API_URL", default_value = "http://127.0.0.1:3000")]
    api: String,
    #[arg(long, env = "MOBIPWN_API_KEY")]
    api_key: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(EnvFilter::from_default_env().add_directive("mobipwn_mcp=info".parse()?))
        .init();

    let cli = Cli::parse();
    tracing::info!(
        api = %cli.api,
        auth = cli.api_key.is_some(),
        "mobipwn-mcp starting (stdio)"
    );

    let server = MobiPwnMcp {
        api: api::ApiClient::new(cli.api, cli.api_key),
    };

    let service = server.serve(stdio()).await?;
    tracing::debug!("{INSTRUCTIONS}");
    service.waiting().await?;
    Ok(())
}
