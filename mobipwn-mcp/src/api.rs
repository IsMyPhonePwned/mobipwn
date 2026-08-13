use anyhow::{anyhow, Context, Result};
use reqwest::{Client, RequestBuilder};
use serde_json::Value;

#[derive(Clone)]
pub struct ApiClient {
    base: String,
    api_key: Option<String>,
    http: Client,
}

impl ApiClient {
    pub fn new(base: String, api_key: Option<String>) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            api_key,
            http: Client::new(),
        }
    }

    fn auth(&self, req: RequestBuilder) -> RequestBuilder {
        if let Some(ref key) = self.api_key {
            req.header("X-API-Key", key)
        } else {
            req
        }
    }

    pub async fn get(&self, path: &str, query: &[(&str, Option<String>)]) -> Result<Value> {
        let mut url = format!("{}{}", self.base, path);
        let qs: Vec<(String, String)> = query
            .iter()
            .filter_map(|(k, v)| v.as_ref().map(|v| ((*k).to_string(), v.clone())))
            .collect();
        if !qs.is_empty() {
            url.push('?');
            url.push_str(
                &qs.iter()
                    .map(|(k, v)| format!("{}={}", urlencoding(k), urlencoding(v)))
                    .collect::<Vec<_>>()
                    .join("&"),
            );
        }
        let req = self.auth(self.http.get(url));
        self.send(req).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Result<Value> {
        let url = format!("{}{}", self.base, path);
        let req = self.auth(self.http.post(url).json(&body));
        self.send(req).await
    }

    async fn send(&self, req: RequestBuilder) -> Result<Value> {
        let resp = req.send().await.context("request failed")?;
        let status = resp.status();
        let text = resp.text().await.context("read body")?;
        if status.is_success() {
            if text.trim().is_empty() {
                return Ok(Value::Null);
            }
            serde_json::from_str(&text).or_else(|_| Ok(Value::String(text)))
        } else {
            Err(anyhow!("HTTP {status}: {text}"))
        }
    }
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

pub fn ok_json(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|e| e.to_string())
}
