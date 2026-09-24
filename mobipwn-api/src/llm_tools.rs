//! Server-side data handlers shared with mobipwn-mcp (session auth for in-app assistant).

use crate::case_audit::build_alert_list_filter;
use crate::AppState;
use mobipwn_core::auth::{AuthContext, Permission};
use mobipwn_core::alerts::{parse_status, status_str};
use mobipwn_search::{SearchRunRequest, SearchRunResponse};
use serde_json::{json, Value};
use uuid::Uuid;

const MAX_JSON_CHARS: usize = 14_000;
const MAX_SEARCH_ROWS: usize = 25;

fn require_perm(ctx: &AuthContext, perm: Permission) -> Result<(), String> {
    if ctx.role.has(perm) {
        Ok(())
    } else {
        Err("permission denied for this action".into())
    }
}

pub async fn execute_assistant_tool(
    state: &AppState,
    ctx: &AuthContext,
    name: &str,
    args: &Value,
) -> String {
    match name {
        "overview" => match tool_overview(state, ctx).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "alerts_list" => match tool_alerts_list(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "alerts_get" => match tool_alerts_get(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "alerts_patch" => match tool_alerts_patch(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "search_run" => match tool_search_run(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "search_compile" => match tool_search_compile(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "cases_list" => match tool_cases_list(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "cases_get" => match tool_cases_get(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "rules_list" => match tool_rules_list(state, ctx).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        "rules_validate_query" => match tool_rules_validate(state, ctx, args).await {
            Ok(v) => ok_json(&v),
            Err(e) => err_json(&e),
        },
        _ => err_json(&format!("unknown tool: {name}")),
    }
}

fn ok_json(v: &impl serde::Serialize) -> String {
    let s = serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into());
    truncate_json(s)
}

fn err_json(msg: &str) -> String {
    json!({ "error": msg }).to_string()
}

fn truncate_json(s: String) -> String {
    if s.len() <= MAX_JSON_CHARS {
        s
    } else {
        format!(
            "{}…\n(truncated — {} bytes total, ask for a narrower query)",
            &s[..MAX_JSON_CHARS],
            s.len()
        )
    }
}

fn str_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

async fn tool_overview(state: &AppState, ctx: &AuthContext) -> Result<Value, String> {
    require_perm(ctx, Permission::SearchRun)?;
    mobipwn_core::fetch_overview(&state.pool.postgres, &state.config)
        .await
        .map(|o| serde_json::to_value(o).unwrap_or(Value::Null))
        .map_err(|e| e.to_string())
}

async fn tool_alerts_list(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::AlertsRead)?;
    let mut filter = build_alert_list_filter(
        &state.pool.postgres,
        ctx,
        str_arg(args, "status").as_deref(),
        str_arg(args, "dismissed").as_deref(),
        str_arg(args, "case_id")
            .as_deref()
            .and_then(|s| Uuid::parse_str(s).ok()),
        str_arg(args, "assignee").as_deref(),
    )
    .await;
    if filter.status.is_none() && str_arg(args, "status").is_none() {
        filter.status = Some(mobipwn_core::alerts::StatusFilter::Exact(
            mobipwn_core::alerts::AlertStatus::New,
        ));
    }
    let alerts = state
        .alerts
        .list_filtered(&filter)
        .await
        .map_err(|e| e.to_string())?;
    let total = alerts.len();
    let slice: Vec<_> = alerts.into_iter().take(40).collect();
    Ok(json!({ "total_returned": slice.len(), "total_matched": total, "alerts": slice }))
}

async fn tool_alerts_get(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::AlertsRead)?;
    let id = str_arg(args, "alert_id").ok_or("alert_id required")?;
    let id = Uuid::parse_str(&id).map_err(|_| "invalid alert_id UUID")?;
    let alert = state
        .alerts
        .get(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("alert not found")?;
    serde_json::to_value(alert).map_err(|e| e.to_string())
}

async fn tool_alerts_patch(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::AlertsWrite)?;
    let id = str_arg(args, "alert_id").ok_or("alert_id required")?;
    let id = Uuid::parse_str(&id).map_err(|_| "invalid alert_id UUID")?;
    let author = crate::case_audit::resolve_alert_author(&state.pool.postgres, ctx, None).await;
    let before = state
        .alerts
        .get(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("alert not found")?;

    if let Some(st) = str_arg(args, "status") {
        let to = parse_status(&st);
        if before.status != to {
            let from = status_str(before.status);
            state
                .alerts
                .update_status(id, to)
                .await
                .map_err(|e| e.to_string())?
                .ok_or("alert not found")?;
            let _ = state
                .alert_events
                .log_status_change(id, from, &st, &author)
                .await;
        }
    }

    let assignee: Option<Option<String>> = if args.get("assignee").is_some() {
        Some(args.get("assignee").and_then(|v| {
            if v.is_null() {
                None
            } else {
                Some(v.as_str().unwrap_or("").to_string())
            }
        }))
    } else {
        None
    };
    let tags = args.get("tags").and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
    });
    if assignee.is_some() || tags.is_some() {
        if let Some(ref a) = assignee {
            let label = a
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("unassigned");
            let _ = state.alert_events.log_assignee_change(id, label, &author).await;
        }
        if let Some(ref t) = tags {
            let _ = state.alert_events.log_tags_change(id, t, &author).await;
        }
        state
            .alerts
            .update_meta(id, assignee, tags)
            .await
            .map_err(|e| e.to_string())?
            .ok_or("alert not found")?;
    }

    if let Some(comment) = str_arg(args, "comment") {
        state
            .alert_events
            .add_comment(id, &comment, &author)
            .await
            .map_err(|e| e.to_string())?;
    }

    if let Some(dismissed) = args.get("dismissed").and_then(|v| v.as_bool()) {
        if dismissed && before.dismissed_at.is_none() {
            state
                .alerts
                .set_dismissed(id, true)
                .await
                .map_err(|e| e.to_string())?
                .ok_or("alert not found")?;
            let _ = state.alert_events.log_dismissed(id, &author).await;
        } else if !dismissed && before.dismissed_at.is_some() {
            state
                .alerts
                .set_dismissed(id, false)
                .await
                .map_err(|e| e.to_string())?
                .ok_or("alert not found")?;
        }
    }

    let updated = state
        .alerts
        .get(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("alert not found")?;
    serde_json::to_value(updated).map_err(|e| e.to_string())
}

async fn tool_search_run(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::SearchRun)?;
    let query = str_arg(args, "query").ok_or("query required")?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n.min(200) as u32)
        .unwrap_or(50);
    let config = state.effective_config().await;
    let mut resp: SearchRunResponse = mobipwn_search::run_search(
        &state.pool,
        &config,
        SearchRunRequest {
            query,
            time_from: str_arg(args, "time_from"),
            time_to: str_arg(args, "time_to"),
            limit: Some(limit),
            search_after: None,
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    if resp.rows.len() > MAX_SEARCH_ROWS {
        resp.rows.truncate(MAX_SEARCH_ROWS);
    }
    serde_json::to_value(resp).map_err(|e| e.to_string())
}

async fn tool_search_compile(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::SearchRun)?;
    use mobipwn_search::admission::resolve_time_bounds;
    use mobipwn_search::{generate_clickhouse_sql, parse_mpl};
    let query = str_arg(args, "query").ok_or("query required")?;
    let mpl = parse_mpl(&query).map_err(|e| e.to_string())?;
    let config = state.effective_config().await;
    let bounds = resolve_time_bounds(
        &mpl,
        str_arg(args, "time_from").as_deref(),
        str_arg(args, "time_to").as_deref(),
        config.search_admission.default_hours,
    );
    let sql = generate_clickhouse_sql(
        &mpl,
        &config.clickhouse_database,
        bounds.time_from.as_deref(),
        bounds.time_to.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "sql": sql }))
}

async fn tool_cases_list(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::CasesRead)?;
    let cases = mobipwn_core::list_cases_with_ingest(
        &state.pool,
        &state.config,
        &state.cases,
        &state.ingest_jobs,
        Some(&state.clickhouse),
        str_arg(args, "status").as_deref(),
        str_arg(args, "q").as_deref(),
        str_arg(args, "owner").as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(cases).map_err(|e| e.to_string())
}

async fn tool_cases_get(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::CasesRead)?;
    let id = str_arg(args, "case_id").ok_or("case_id required")?;
    let id = Uuid::parse_str(&id).map_err(|_| "invalid case_id UUID")?;
    let case = state
        .cases
        .get(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("case not found")?;
    serde_json::to_value(case).map_err(|e| e.to_string())
}

async fn tool_rules_list(state: &AppState, ctx: &AuthContext) -> Result<Value, String> {
    require_perm(ctx, Permission::RulesRead)?;
    let rules = state.rules.list().await.map_err(|e| e.to_string())?;
    serde_json::to_value(rules).map_err(|e| e.to_string())
}

async fn tool_rules_validate(state: &AppState, ctx: &AuthContext, args: &Value) -> Result<Value, String> {
    require_perm(ctx, Permission::RulesRead)?;
    let query = str_arg(args, "query").ok_or("query required")?;
    let mode = str_arg(args, "mode").unwrap_or_else(|| "scheduled".into());
    let config = state.effective_config().await;
    let result = mobipwn_search::validate_detection_rule(&state.pool, &config, &query, &mode)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}
