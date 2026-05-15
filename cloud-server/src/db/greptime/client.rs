// Copyright (c) 2025 CC-Island Contributors
// SPDX-License-Identifier: MIT

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_HOST: &str = "localhost";
const DEFAULT_PORT: u16 = 4000;

#[derive(Debug, Clone)]
pub struct GreptimeClient {
    client: Client,
    host: String,
    port: u16,
    database: String,
}

impl GreptimeClient {
    pub fn new(host: Option<String>, port: Option<u16>, database: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap(),
            host: host.unwrap_or(DEFAULT_HOST.to_string()),
            port: port.unwrap_or(DEFAULT_PORT),
            database: database.unwrap_or("public".to_string()),
        }
    }

    /// Execute SQL query via HTTP API
    pub async fn query(&self, sql: &str) -> Result<QueryResult, Box<dyn std::error::Error>> {
        let url = format!(
            "http://{}:{}/v1/sql?db={}&sql={}",
            self.host,
            self.port,
            self.database,
            urlencoding::encode(sql)
        );

        let resp = self.client.get(&url).send().await?;
        let result: QueryResult = resp.json().await?;
        Ok(result)
    }

    /// Insert rows into table
    pub async fn insert(
        &self,
        table: &str,
        rows: Vec<Vec<Value>>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // GreptimeDB uses SQL INSERT syntax via HTTP
        let sql = self.build_insert_sql(table, rows);
        self.query(&sql).await?;
        Ok(())
    }

    fn build_insert_sql(&self, table: &str, rows: Vec<Vec<Value>>) -> String {
        // Build INSERT statement from rows
        let values_str = rows
            .iter()
            .map(|row| {
                let vals = row
                    .iter()
                    .map(|v| v.to_sql_literal())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("({})", vals)
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!("INSERT INTO {} VALUES {}", table, values_str)
    }
}

#[derive(Debug, Deserialize)]
pub struct QueryResult {
    #[serde(default)]
    pub output: Vec<OutputBlock>,
}

#[derive(Debug, Deserialize)]
pub struct OutputBlock {
    pub records: Records,
}

#[derive(Debug, Deserialize)]
pub struct Records {
    pub rows: Vec<Vec<Value>>,
    pub schema: Schema,
}

#[derive(Debug, Deserialize)]
pub struct Schema {
    pub column_schemas: Vec<ColumnSchema>,
}

#[derive(Debug, Deserialize)]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    String(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Null,
}

impl Value {
    pub fn to_sql_literal(&self) -> String {
        match self {
            Value::String(s) => format!("'{}'", s.replace('\'', "''")),
            Value::Int(i) => i.to_string(),
            Value::Float(f) => f.to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Null => "NULL".to_string(),
        }
    }
}