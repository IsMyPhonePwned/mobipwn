use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Deserialize)]
pub struct LlmChatRequest {
    pub messages: Vec<LlmMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct LlmChatResponse {
    pub message: LlmMessage,
    pub mock: bool,
}

#[derive(Debug, Serialize)]
pub struct LlmTestResult {
    pub ok: bool,
    pub endpoint: String,
    pub model: String,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

/// True when the upstream returned nothing useful (empty body, literal "No response", etc.).
pub fn is_weak_llm_reply(content: &str) -> bool {
    let t = content.trim();
    t.is_empty()
        || t.eq_ignore_ascii_case("no response")
        || t.contains("model returned an empty reply")
}

const SYSTEM_PROMPT: &str = "\
You are the MobiPwn in-app assistant for mobile DFIR analysts (Android bugreports, iOS sysdiagnose).

When a **LIVE CONTEXT** block is present below, it was queried from MobiPwn just now (same data as the REST API / MCP). \
Use those facts to answer directly. Never say you lack database access when LIVE CONTEXT is provided. \
Never invent rows that are not in LIVE CONTEXT.

Product map (use these real paths):
- Alert queue / triage: sidebar **Alerts** (`/alerts`) — status **new** = inbox, **triaged** = in progress, \
**verified** / **false_positive** = closed. Grouped vs flat view toggles on that page.
- Hunt events: **Search** (`/search`) with mPL; case scope `source=\"case-001\"`.
- Detection rules: **Rules** (`/rules`). Cases: **Cases**. Health & MCP: **Health** (`/health`).
- REST API (same data): `GET /v1/alerts?status=new`, `GET /v1/alerts/groups`, `POST /v1/search/run` with mPL query.

Response style:
- Answer the question directly in plain language (short paragraphs or bullets).
- Use a fenced ```mpl block ONLY when the user wants a search/detection query — not for navigation questions.
- Never output SQL (no SELECT/WHERE/GROUP BY). Use mPL only in code blocks.
- Never show chain-of-thought, \"Thinking Process\", or step-by-step internal reasoning.

mPL cheat sheet:
- Case scope: source=\"case-001\"
- Platform: platform=\"android\" or platform=\"ios\"
- Package field: bundle_id (not package_name)
- Installer: installer (Play Store = com.android.vending)
- Time: last 30d, last 24h, last 7d (prefix on the search clause)
- Sideloaded apps: installer=* !installer=\"com.android.vending\"
- Pipes: | stats count by bundle_id | sort -timestamp | head 100

Example mPL (sideloaded apps on one case):
```mpl
source=\"case-001\" platform=\"android\" installer=* !installer=\"com.android.vending\"
| stats count by bundle_id, installer
| head 50
```";

/// Normalize chat history for OpenAI-compatible upstreams (Ollama, LM Studio, hosted APIs).
pub fn prepare_upstream_messages(
    messages: Vec<LlmMessage>,
    live_context: Option<&str>,
) -> anyhow::Result<Vec<LlmMessage>> {
    let mut system = SYSTEM_PROMPT.to_string();
    if let Some(ctx) = live_context.filter(|s| !s.trim().is_empty()) {
        system.push_str("\n\n--- LIVE CONTEXT (from MobiPwn now) ---\n");
        system.push_str(ctx);
    }
    let mut out = vec![LlmMessage {
        role: "system".to_string(),
        content: system,
    }];

    let mut seen_user = false;
    for m in messages {
        let role = m.role.trim().to_lowercase();
        let content = m.content.trim();
        if content.is_empty() {
            continue;
        }
        if !matches!(role.as_str(), "system" | "user" | "assistant") {
            continue;
        }
        if role == "assistant" && !seen_user {
            continue;
        }
        if role == "system" {
            if out.len() == 1 && out[0].role == "system" {
                out[0].content = content.to_string();
            } else {
                out.push(LlmMessage {
                    role: "system".into(),
                    content: content.to_string(),
                });
            }
            continue;
        }
        if role == "user" {
            seen_user = true;
        }
        out.push(LlmMessage {
            role: role.to_string(),
            content: content.to_string(),
        });
    }

    if !out.iter().any(|m| m.role == "user") {
        anyhow::bail!("No user message to send to the LLM");
    }
    if out.last().is_none_or(|m| m.role != "user") {
        anyhow::bail!("Last message must be from the user");
    }

    Ok(out)
}

pub async fn chat(
    api_url: Option<&str>,
    api_key: Option<&str>,
    model: &str,
    messages: Vec<LlmMessage>,
    live_context: Option<&str>,
) -> anyhow::Result<LlmChatResponse> {
    let user_message = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let Some(url) = api_url.filter(|s| !s.is_empty()) else {
        return Ok(mock_reply(&user_message));
    };
    let key = api_key.filter(|s| !s.is_empty());
    let model = model.trim();
    if model.is_empty() {
        anyhow::bail!("LLM model is not configured — set it in Settings");
    }
    let upstream = prepare_upstream_messages(messages, live_context)?;
    let endpoint = format!("{}/chat/completions", url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": upstream,
        "max_tokens": 1024,
        "temperature": 0.2,
        "think": false,
    });
    let client = llm_http_client()?;
    let mut req = client.post(&endpoint).json(&body);
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("LLM upstream error ({endpoint}): {text}");
    }
    let json: serde_json::Value = resp.json().await?;
    let raw = extract_completion_content(&json).unwrap_or_default();
    let content = finalize_assistant_content(&raw, &user_message);
    Ok(LlmChatResponse {
        message: LlmMessage {
            role: "assistant".to_string(),
            content,
        },
        mock: false,
    })
}

/// Probe the configured OpenAI-compatible endpoint with a minimal chat request.
pub async fn test_connection(
    api_url: &str,
    api_key: Option<&str>,
    model: &str,
) -> LlmTestResult {
    let url = api_url.trim();
    let model = model.trim();
    let endpoint = format!("{}/chat/completions", url.trim_end_matches('/'));

    if url.is_empty() {
        return LlmTestResult {
            ok: false,
            endpoint,
            model: model.to_string(),
            latency_ms: 0,
            reply_preview: None,
            error: Some("API URL is empty".into()),
            hint: Some("Set Base URL in Settings → LLM (e.g. http://127.0.0.1:1234/v1)".into()),
        };
    }
    if model.is_empty() {
        return LlmTestResult {
            ok: false,
            endpoint,
            model: String::new(),
            latency_ms: 0,
            reply_preview: None,
            error: Some("Model id is empty".into()),
            hint: Some("Set Model to the id your server expects (LM Studio: loaded model name)".into()),
        };
    }

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "user", "content": "Reply with exactly: MobiPwn OK" }
        ],
        "max_tokens": 64,
        "temperature": 0,
        "think": false,
    });

    let started = Instant::now();
    let client = match llm_http_client() {
        Ok(c) => c,
        Err(e) => {
            return LlmTestResult {
                ok: false,
                endpoint,
                model: model.to_string(),
                latency_ms: 0,
                reply_preview: None,
                error: Some(e.to_string()),
                hint: None,
            };
        }
    };
    let mut req = client.post(&endpoint).json(&body);
    if let Some(k) = api_key.filter(|s| !s.is_empty()) {
        req = req.bearer_auth(k);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let hint = if e.is_connect() || e.is_timeout() {
                Some(
                    "Cannot reach the LLM server — is Ollama/LM Studio running and listening on this URL?"
                        .into(),
                )
            } else {
                None
            };
            return LlmTestResult {
                ok: false,
                endpoint,
                model: model.to_string(),
                latency_ms: started.elapsed().as_millis() as u64,
                reply_preview: None,
                error: Some(e.to_string()),
                hint,
            };
        }
    };

    let latency_ms = started.elapsed().as_millis() as u64;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return LlmTestResult {
            ok: false,
            endpoint,
            model: model.to_string(),
            latency_ms,
            reply_preview: None,
            error: Some(format!("HTTP {}: {}", status, truncate_preview(&text, 400))),
            hint: status_hint(status.as_u16()),
        };
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return LlmTestResult {
                ok: false,
                endpoint,
                model: model.to_string(),
                latency_ms,
                reply_preview: None,
                error: Some(format!("Invalid JSON from LLM: {e}")),
                hint: None,
            };
        }
    };

    if let Some(err) = json.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| err.to_string());
        return LlmTestResult {
            ok: false,
            endpoint,
            model: model.to_string(),
            latency_ms,
            reply_preview: None,
            error: Some(msg),
            hint: Some("Check model id and API key — use Test connection after saving settings.".into()),
        };
    }

    match extract_completion_content(&json) {
        Some(reply) => {
            let preview = truncate_preview(&reply, 240);
            LlmTestResult {
                ok: true,
                endpoint,
                model: model.to_string(),
                latency_ms,
                reply_preview: Some(preview),
                error: None,
                hint: None,
            }
        }
        None => LlmTestResult {
            ok: false,
            endpoint,
            model: model.to_string(),
            latency_ms,
            reply_preview: None,
            error: Some(
                "Connected but the model returned empty content (common with reasoning-only models)."
                    .into(),
            ),
            hint: Some(
                "In LM Studio disable extended thinking, pick a chat model, or try a smaller instruct model."
                    .into(),
            ),
        },
    }
}

fn llm_http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(Into::into)
}

fn extract_completion_content(json: &serde_json::Value) -> Option<String> {
    let choice = json.get("choices")?.get(0)?;
    let message = choice.get("message")?;
    for key in ["content", "reasoning_content"] {
        if let Some(s) = message
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(s.to_string());
        }
    }
    choice
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn truncate_preview(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

fn status_hint(status: u16) -> Option<String> {
    match status {
        401 | 403 => Some("Invalid or missing API key.".into()),
        404 => Some("Wrong base URL — use …/v1 (e.g. http://127.0.0.1:1234/v1).".into()),
        429 => Some("Rate limited — retry or use a different model.".into()),
        _ => None,
    }
}

/// Post-process assistant text (strip thinking blocks, local fallbacks).
pub fn finalize_assistant_content_public(raw: &str, user_message: &str) -> String {
    finalize_assistant_content(raw, user_message)
}

fn finalize_assistant_content(raw: &str, user_message: &str) -> String {
    let sanitized = sanitize_assistant_content(raw);
    if sanitized.trim().is_empty() {
        return local_fallback_reply(user_message).unwrap_or_else(|| {
            "The model returned an empty reply (often after stripping hidden thinking). \
             Try again, disable extended reasoning in LM Studio, or ask a shorter question."
                .into()
        });
    }
    if is_chain_of_thought_only(&sanitized) {
        if let Some(fallback) = local_fallback_reply(user_message) {
            return fallback;
        }
        // Prefer the model's answer over forcing an unrelated mPL template.
        if sanitized.len() > 80 && looks_like_helpful_answer(&sanitized) {
            return sanitized;
        }
        return local_fallback_reply(user_message).unwrap_or(sanitized);
    }
    sanitized
}

fn sanitize_assistant_content(raw: &str) -> String {
    let mut s = strip_redacted_thinking(raw);
    for tag in ["think", "thinking", "reasoning"] {
        s = strip_xml_blocks(&s, tag);
    }

    if let Some(block) = extract_fenced_code(&s) {
        let intro = s.split("```").next().unwrap_or("").trim();
        let intro = truncate_intro(intro);
        if intro.is_empty() {
            return format!("```mpl\n{}\n```", block.trim());
        }
        return format!("{intro}\n\n```mpl\n{}\n```", block.trim());
    }

    s.trim().to_string()
}

fn strip_redacted_thinking(s: &str) -> String {
    const OPEN: &str = "\x3credacted_thinking\x3e";
    const CLOSE: &str = "\x3c/redacted_thinking\x3e";
    strip_delimited_blocks(s, OPEN, CLOSE)
}

fn strip_xml_blocks(s: &str, tag: &str) -> String {
    let open = ["\x3c", tag, "\x3e"].concat();
    let close = ["\x3c/", tag, "\x3e"].concat();
    strip_delimited_blocks(s, &open, &close)
}

fn strip_delimited_blocks(s: &str, open: &str, close: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find(open) {
        out.push_str(&rest[..start]);
        if let Some(end) = rest[start..].find(close) {
            rest = &rest[start + end + close.len()..];
        } else {
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out
}

fn extract_fenced_code(s: &str) -> Option<String> {
    let mut rest = s;
    while let Some(start) = rest.find("```") {
        let after_open = &rest[start + 3..];
        let body_start = after_open
            .find('\n')
            .map(|i| i + 1)
            .unwrap_or(after_open.len());
        let body = &after_open[body_start..];
        if let Some(end) = body.find("```") {
            let code = body[..end].trim();
            if !code.is_empty() {
                return Some(code.to_string());
            }
            rest = &body[end + 3..];
        } else {
            break;
        }
    }
    None
}

fn truncate_intro(intro: &str) -> String {
    intro
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("Thinking Process")
                && !line.starts_with("**Analyze the Request:**")
        })
        .take(2)
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_chain_of_thought_only(content: &str) -> bool {
    let t = content.trim();
    if t.is_empty() {
        return true;
    }
    if content.contains("```")
        || content.contains("source=\"")
        || content.contains("| stats")
        || content.contains("| head")
    {
        return false;
    }
    if looks_like_helpful_answer(content) {
        return false;
    }
    let lower = content.to_lowercase();
    lower.contains("thinking process")
        || lower.contains("**analyze the request:**")
        || lower.contains("drafting the mpl query")
        || lower.contains("refining the query for mpl syntax")
}

fn looks_like_helpful_answer(content: &str) -> bool {
    let lower = content.to_lowercase();
    lower.contains("/alerts")
        || lower.contains("alerts page")
        || lower.contains("sidebar")
        || lower.contains("/v1/alerts")
        || lower.contains("status=new")
        || lower.contains("status \"new\"")
        || lower.contains("mobipwn")
        || lower.contains("triage")
        || lower.contains("search page")
        || lower.contains("/search")
        || (content.contains('\n') && content.lines().count() >= 2)
}

fn local_fallback_reply(user: &str) -> Option<String> {
    let u = user.to_lowercase();

    let asks_alerts = u.contains("alert")
        && (u.contains("list")
            || u.contains("queue")
            || u.contains("pending")
            || u.contains("inbox")
            || u.contains("open")
            || u.contains("show")
            || u.contains("what")
            || u.contains("triage"));
    if asks_alerts {
        return Some(
            "I couldn't load alerts from the database right now. Open **Alerts** (`/alerts`) — \
            **New** is the inbox queue — or retry after restarting mobipwn-api."
                .into(),
        );
    }

    if looks_like_mpl_fragment(user) {
        let q = user.trim();
        return Some(format!(
            "Run this in **Search** (`/search`):\n\n```mpl\n{q}\n| sort -timestamp\n| head 100\n```\n\n\
            Add `source=\"case-…\"` to scope a case, or `last 7d` for a time window."
        ));
    }

    let sideload = u.contains("sideload")
        || (u.contains("play store") && u.contains("install"))
        || (u.contains("outside") && u.contains("play"))
        || (u.contains("installer") && u.contains("android") && u.contains("count"));
    if !sideload {
        return None;
    }
    let source = extract_source_label(user).unwrap_or_else(|| "case-001".to_string());
    let time = if u.contains("30 day") || u.contains("30d") || u.contains("last 30") {
        " last 30d"
    } else {
        ""
    };
    Some(format!(
        "Non-Play-Store installs scoped to {source}:\n\n```mpl\nsource=\"{source}\" platform=\"android\"{time} installer=* !installer=\"com.android.vending\"\n| stats count by bundle_id, installer\n| head 50\n```"
    ))
}

fn looks_like_mpl_fragment(s: &str) -> bool {
    let t = s.trim();
    if t.is_empty() || t.len() > 500 {
        return false;
    }
    t.contains("platform=")
        || t.contains("bundle_id=")
        || t.contains("installer=")
        || t.contains("source=")
        || t.contains("parser=")
        || t.starts_with('|')
        || t.contains(" | ")
}

fn extract_source_label(user: &str) -> Option<String> {
    if let Some(idx) = user.find("source=\"") {
        let rest = &user[idx + 8..];
        if let Some(end) = rest.find('"') {
            return Some(rest[..end].to_string());
        }
    }
    for needle in ["case ", "case-"] {
        if let Some(idx) = user.to_lowercase().find(needle) {
            let rest = user[idx + needle.len()..].trim();
            let label: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if !label.is_empty() {
                return Some(if needle == "case " && !label.starts_with("case-") {
                    format!("case-{label}")
                } else {
                    label
                });
            }
        }
    }
    None
}

pub fn mock_reply(user_message: &str) -> LlmChatResponse {
    if let Some(content) = local_fallback_reply(user_message) {
        return LlmChatResponse {
            message: LlmMessage {
                role: "assistant".to_string(),
                content,
            },
            mock: true,
        };
    }
    let last = user_message;
    let content = if last.to_lowercase().contains("query") || last.contains("mPL") {
        "Try: `last 24h platform=\"android\" | timechart span=1h count by parser limit=8`. \
         Configure an OpenAI-compatible LLM in Settings for live answers."
            .to_string()
    } else {
        "Configure an OpenAI-compatible LLM in **Settings → LLM** (Ollama, LM Studio, or a hosted API). \
         I can help with the Alerts queue, mPL hunts, rules, and triage — I don't see live data until you connect a model."
            .to_string()
    };
    LlmChatResponse {
        message: LlmMessage {
            role: "assistant".to_string(),
            content,
        },
        mock: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_welcome_assistant_before_first_user() {
        let prepared = prepare_upstream_messages(
            vec![
                LlmMessage {
                    role: "assistant".into(),
                    content: "Welcome.".into(),
                },
                LlmMessage {
                    role: "user".into(),
                    content: "build an mPL query".into(),
                },
            ],
            None,
        )
        .unwrap();
        assert_eq!(prepared[0].role, "system");
        assert_eq!(prepared.len(), 2);
        assert_eq!(prepared[1].role, "user");
    }

    #[test]
    fn strips_think_blocks_and_keeps_mpl_fence() {
        let raw = concat!(
            "Short intro.\n\n",
            "\x3credacted_thinking\x3e\nSELECT bad\n\x3c/redacted_thinking\x3e\n",
            "```\nsource=\"case-001\" platform=\"android\" installer=*\n| stats count() by bundle_id\n```"
        );
        let out = sanitize_assistant_content(raw);
        assert!(!out.contains("SELECT bad"));
        assert!(out.contains("```mpl"));
        assert!(out.contains("source=\"case-001\""));
    }

    #[test]
    fn chain_of_thought_sideload_fallback() {
        let raw = "Thinking Process: 1. **Analyze the Request:** hunt sideloaded apps...";
        let user = "Hunt sideloaded apps on Android case case-001. Show package, installer, and count. Use last 30 days if needed.";
        let out = finalize_assistant_content(raw, user);
        assert!(out.contains("```mpl"));
        assert!(out.contains("source=\"case-001\""));
        assert!(out.contains("bundle_id, installer"));
        assert!(!out.contains("Thinking Process"));
    }

    #[test]
    fn alert_queue_question_gets_navigation_not_mpl_error() {
        let raw = "Thinking Process: 1. **Analyze the Request:** user wants alerts...";
        let user = "Give me the list of alerts in the queue";
        let out = finalize_assistant_content(raw, user);
        assert!(out.contains("Alerts") || out.contains("/alerts"));
        assert!(!out.contains("The model returned analysis instead of mPL"));
    }

    #[test]
    fn mpl_fragment_gets_runnable_query() {
        let raw = "";
        let user = r#"platform="android" installer=* !installer="com.android.vending""#;
        let out = finalize_assistant_content(raw, user);
        assert!(out.contains("```mpl"));
        assert!(out.contains("platform=\"android\""));
        assert!(!out.contains("The model returned analysis instead of mPL"));
    }

    #[test]
    fn helpful_alert_answer_passes_through() {
        let raw = "Open the Alerts page from the sidebar. Filter by status new to see the queue.";
        let user = "list alerts";
        let out = finalize_assistant_content(raw, user);
        assert!(out.contains("Alerts"));
        assert!(!out.contains("The model returned analysis instead of mPL"));
    }

    #[test]
    fn weak_reply_detection() {
        assert!(is_weak_llm_reply(""));
        assert!(is_weak_llm_reply("No response"));
        assert!(!is_weak_llm_reply("Here are your alerts."));
    }

    #[test]
    fn extract_content_from_reasoning_field() {
        let json = serde_json::json!({
            "choices": [{ "message": { "content": null, "reasoning_content": "MobiPwn OK" } }]
        });
        assert_eq!(
            extract_completion_content(&json).as_deref(),
            Some("MobiPwn OK")
        );
    }

    #[test]
    fn extracts_case_label_from_prompt() {
        assert_eq!(
            extract_source_label("Hunt sideloaded apps on Android case case-001."),
            Some("case-001".to_string())
        );
    }
}
