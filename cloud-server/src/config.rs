use anyhow::Result;

/// Application configuration from environment
pub struct Config {
    pub database_url: String,
    pub ws_port: u16,
    pub cleanup_interval_secs: u64,
    pub max_device_age_secs: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok(); // Load .env file if present

        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");

        let ws_port = std::env::var("WS_PORT")
            .unwrap_or_else(|_| "17528".to_string())
            .parse()
            .expect("WS_PORT must be a valid number");

        let cleanup_interval_secs = std::env::var("CLEANUP_INTERVAL_SECS")
            .unwrap_or_else(|_| "3600".to_string())
            .parse()
            .expect("CLEANUP_INTERVAL_SECS must be valid");

        let max_device_age_secs = std::env::var("MAX_DEVICE_AGE_SECS")
            .unwrap_or_else(|_| "86400".to_string())
            .parse()
            .expect("MAX_DEVICE_AGE_SECS must be valid");

        Ok(Self {
            database_url,
            ws_port,
            cleanup_interval_secs,
            max_device_age_secs,
        })
    }
}