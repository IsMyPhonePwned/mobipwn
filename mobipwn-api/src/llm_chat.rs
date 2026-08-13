//! In-app assistant: session auth, server-side live data, single call to Settings → LLM.
//!
//! MCP (`mobipwn-mcp`) is the separate path for external LLM hosts (Cursor, Claude, LM Studio + MCP).

use crate::case_audit::build_alert_list_filter;
use crate::llm_tools::execute_assistant_tool;
use crate::AppState;
use mobipwn_core::auth::AuthContext;
use mobipwn_core::llm;
use mobipwn_core::platform_settings::LlmConfig;
use mobipwn_core::{
    fetch_alerts_for_assistant, format_alert_list_reply, format_alerts_live_context,
    is_direct_alert_list_request, parse_alert_status_filter, status_filter_label, wants_alert_data,
    LlmChatResponse, LlmMessage,
};
use serde_json::json;

pub async fn run_assistant_chat(
    state: &AppState,
    ctx: &AuthContext,
    cfg: &LlmConfig,
    messages: Vec<LlmMessage>,
) -> Result<LlmChatResponse, String> {
    let user_message = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let url = cfg.api_url.trim();
    let model = cfg.model.trim();
    let key = (!cfg.api_key.is_empty()).then_some(cfg.api_key.as_str());

    // No LLM configured — answer data questions directly from the API layer.
    if url.is_empty() {
        return offline_reply(state, ctx, &user_message).await;
    }
    if model.is_empty() {
        return Err("LLM model is not configured — set it in Settings → LLM".into());
    }

    let live_context = gather_live_context(state, ctx, &user_message).await;
    let had_live_data = live_context.is_some();

    let res = llm::chat(Some(url), key, model, messages, live_context.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    if llm::is_weak_llm_reply(&res.message.content) && had_live_data {
        if let Ok(fb) = offline_reply(state, ctx, &user_message).await {
            return Ok(mobipwn_core::LlmChatResponse {
                message: mobipwn_core::LlmMessage {
                    role: "assistant".into(),
                    content: format!(
                        "The LLM returned no usable text — use **Test connection** in Settings → LLM. \
                         Live data from MobiPwn:\n\n{}",
                        fb.message.content
                    ),
                },
                mock: false,
            });
        }
    }

    Ok(res)
}

async fn offline_reply(
    state: &AppState,
    ctx: &AuthContext,
    user_message: &str,
) -> Result<LlmChatResponse, String> {
    if is_direct_alert_list_request(user_message) {
        let status = parse_alert_status_filter(user_message);
        let label = status_filter_label(status);
        let filter = build_alert_list_filter(
            &state.pool.postgres,
            ctx,
            Some(label_status_arg(status)),
            None,
            None,
            None,
        )
        .await;
        let alerts = fetch_alerts_for_assistant(&state.alerts, &filter)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(LlmChatResponse {
            message: LlmMessage {
                role: "assistant".into(),
                content: format_alert_list_reply(&alerts, label),
            },
            mock: true,
        });
    }

    if let Some(ctx_text) = gather_live_context(state, ctx, user_message).await {
        return Ok(LlmChatResponse {
            message: LlmMessage {
                role: "assistant".into(),
                content: format!(
                    "LLM is not configured (Settings → LLM). Live data from MobiPwn:\n\n{ctx_text}\n\n\
                     Configure an OpenAI-compatible endpoint for natural-language summaries."
                ),
            },
            mock: true,
        });
    }

    Ok(llm::mock_reply(user_message))
}

fn label_status_arg(status: mobipwn_core::alerts::StatusFilter) -> &'static str {
    use mobipwn_core::alerts::{AlertStatus, StatusFilter};
    match status {
        StatusFilter::Open => "open",
        StatusFilter::Exact(AlertStatus::New) => "new",
        StatusFilter::Exact(AlertStatus::Triaged) => "triaged",
        StatusFilter::Exact(AlertStatus::Verified) => "verified",
        StatusFilter::Exact(AlertStatus::FalsePositive) => "false_positive",
    }
}

/// Fetch live platform data when the user message implies it (same handlers as MCP tools).
async fn gather_live_context(
    state: &AppState,
    ctx: &AuthContext,
    user_message: &str,
) -> Option<String> {
    let u = user_message.to_lowercase();
    let mut sections = Vec::new();

    if wants_alert_data(user_message) {
        let status = parse_alert_status_filter(user_message);
        let label = status_filter_label(status);
        let filter = build_alert_list_filter(
            &state.pool.postgres,
            ctx,
            Some(label_status_arg(status)),
            None,
            None,
            None,
        )
        .await;
        if let Ok(alerts) = fetch_alerts_for_assistant(&state.alerts, &filter).await {
            sections.push(format_alerts_live_context(&alerts, label));
        }
    }

    if wants_overview_data(&u) {
        let data = execute_assistant_tool(state, ctx, "overview", &json!({})).await;
        sections.push(format!("Platform overview:\n{data}"));
    }

    if wants_cases_list(&u) {
        let data = execute_assistant_tool(state, ctx, "cases_list", &json!({})).await;
        sections.push(format!("Cases:\n{data}"));
    }

    if wants_rules_list(&u) {
        let data = execute_assistant_tool(state, ctx, "rules_list", &json!({})).await;
        sections.push(format!("Detection rules:\n{data}"));
    }

    if sections.is_empty() {
        None
    } else {
        Some(sections.join("\n\n"))
    }
}

fn wants_overview_data(u: &str) -> bool {
    u.contains("overview")
        || u.contains("how many event")
        || u.contains("event count")
        || u.contains("platform stat")
        || (u.contains("how many") && (u.contains("rule") || u.contains("event") || u.contains("alert")))
}

fn wants_cases_list(u: &str) -> bool {
    u.contains("case") && (u.contains("list") || u.contains("show") || u.contains("give") || u.contains("what"))
}

fn wants_rules_list(u: &str) -> bool {
    u.contains("rule") && (u.contains("list") || u.contains("show") || u.contains("give") || u.contains("what"))
        && !u.contains("validate")
        && !u.contains("create")
}
