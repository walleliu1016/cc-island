// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT
mod config;
mod messages;
mod db;
mod ws;
mod http;

use tokio_util::sync::CancellationToken;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry::trace::TracerProvider as TracerProviderTrait;
use opentelemetry_sdk::Resource;
use config::Config;
use db::pool::create_pool;
use db::repository::Repository;
use ws::router::ConnectionRouter;
use ws::server::run_server;

/// Initialize OpenTelemetry tracing if enabled
fn init_tracing(config: &Config) {
    // Environment variables override config
    let enabled = std::env::var("CC_ISLAND_TRACING_ENABLED")
        .map(|v| v == "true")
        .unwrap_or(config.enable_tracing);

    let endpoint = std::env::var("CC_ISLAND_OTEL_ENDPOINT")
        .ok()
        .or(config.otel_endpoint.clone());

    if !enabled || endpoint.is_none() {
        tracing_subscriber::fmt::init();
        tracing::info!("Tracing disabled or no endpoint configured");
        return;
    }

    tracing::info!("Initializing OpenTelemetry tracing with endpoint: {}", endpoint.as_ref().unwrap());

    // Create OTLP span exporter
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint.unwrap())
        .build()
        .expect("Failed to build OTLP span exporter");

    // Create TracerProvider with batch exporter
    let tracer_provider = opentelemetry_sdk::trace::TracerProvider::builder()
        .with_batch_exporter(exporter, opentelemetry_sdk::runtime::Tokio)
        .with_resource(
            Resource::new(vec![
                opentelemetry::KeyValue::new("service.name", "cc-island-cloud"),
            ])
        )
        .build();

    // Get tracer from provider
    let tracer = tracer_provider.tracer("cc-island-cloud");

    // Register tracing layer with fmt layer
    tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("OpenTelemetry tracing initialized successfully");
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load configuration first (before init_tracing for endpoint info)
    let config = Config::from_env()?;

    // Initialize tracing with config
    init_tracing(&config);

    tracing::info!("Starting CC-Island Cloud Server...");

    // Create database pool
    let pool = create_pool(&config.database_url).await?;
    tracing::info!("Database connected");

    // Run migrations
    db::pool::run_migrations(&pool).await?;
    tracing::info!("Migrations complete");

    // Create shared components
    let repo = Repository::new(pool.clone());
    let router = ConnectionRouter::new();

    // Create shutdown token
    let shutdown = CancellationToken::new();

    // Spawn HTTP server for API endpoints
    let http_router = http::create_http_router(repo.clone(), router.clone());
    let http_port = config.http_port;
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", http_port)).await.unwrap();
        tracing::info!("HTTP API server listening on {}", http_port);
        axum::serve(listener, http_router).await.unwrap();
    });

    // Handle Ctrl+C for graceful shutdown
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for Ctrl+C");
        tracing::info!("Ctrl+C received, initiating shutdown");
        shutdown_clone.cancel();
    });

    // Run WebSocket server
    run_server(config.ws_port, router, repo, shutdown).await?;

    tracing::info!("Server shutdown complete");
    Ok(())
}