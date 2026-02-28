use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageHttpResult {
  pub ok: bool,
  pub status: u16,
  pub body: Option<Value>,
  pub text: Option<String>,
}

fn build_usage_url(base_url: &str) -> Result<String, String> {
  let trimmed = base_url.trim().trim_end_matches('/');
  if trimmed.is_empty() {
    return Err("Base URL cannot be empty.".to_string());
  }
  if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
    return Err("Base URL must start with http:// or https://".to_string());
  }
  Ok(format!("{trimmed}/codex/v1/usage"))
}

pub fn query_codex_usage(base_url: String, api_key: String) -> Result<CodexUsageHttpResult, String> {
  let url = build_usage_url(&base_url)?;
  let token = api_key.trim();
  if token.is_empty() {
    return Err("API key cannot be empty.".to_string());
  }

  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(12))
    .build()
    .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

  let response = client
    .get(&url)
    .header("Authorization", format!("Bearer {token}"))
    .header("User-Agent", "cc-switch/1.0")
    .send()
    .map_err(|error| format!("Request failed: {error}"))?;

  let status = response.status().as_u16();
  let ok = response.status().is_success();
  let text = response.text().unwrap_or_default();
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return Ok(CodexUsageHttpResult {
      ok,
      status,
      body: None,
      text: None,
    });
  }

  match serde_json::from_str::<Value>(trimmed) {
    Ok(parsed) => Ok(CodexUsageHttpResult {
      ok,
      status,
      body: Some(parsed),
      text: None,
    }),
    Err(_) => Ok(CodexUsageHttpResult {
      ok,
      status,
      body: None,
      text: Some(trimmed.to_string()),
    }),
  }
}
