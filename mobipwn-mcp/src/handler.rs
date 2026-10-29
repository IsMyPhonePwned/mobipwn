use crate::api::{ok_json, ApiClient};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::*,
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, RoleServer, ServerHandler,
    service::RequestContext,
};
use serde_json::json;

pub const INSTRUCTIONS: &str = "\
MobiPwn MCP — mobile SIEM hunt & triage for external LLM agents (nano-investigator style).

Workflow: read mobipwn://docs/agents-crafting-searches → mudm_list_fields or search_fields_in_scope → \
draft mPL with source=\"case-…\" or last Nh → search_run (use | head while iterating) → \
alerts/cases tools for triage → rules_validate_query to promote standing hunts.

mPL replaces nano nPL. Prefer case-scoped queries on Android bugreport / iOS sysdiagnose data.";

const DOC_AGENTS: &str = include_str!("../../docs/AGENTS.md");
const DOC_CRAFTING: &str = include_str!("../../docs/AGENTS_CRAFTING_SEARCHES.md");
const DOC_MPL: &str = include_str!("../../docs/MPL_LANGUAGE.md");
const DOC_ANDROID: &str = include_str!("../../docs/ANDROID_SEARCH.md");

#[derive(Clone)]
pub struct MobiPwnMcp {
    pub api: ApiClient,
}

#[tool_router]
impl MobiPwnMcp {
    #[tool(description = "Execute an mPL search query against MobiPwn events")]
    async fn search_run(
        &self,
        Parameters(p): Parameters<SearchRunParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "time_from": p.time_from,
            "time_to": p.time_to,
            "limit": p.limit,
            "search_after": p.search_after,
        });
        self.api
            .post("/v1/search/run", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Compile mPL to ClickHouse SQL (debug / teach syntax)")]
    async fn search_compile(
        &self,
        Parameters(p): Parameters<SearchCompileParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "time_from": p.time_from,
            "time_to": p.time_to,
        });
        self.api
            .post("/v1/search/compile", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List the full MUDM searchable field catalog")]
    async fn mudm_list_fields(&self) -> Result<String, String> {
        self.api
            .get("/v1/mudm/fields", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Top values for a field under optional mPL scope")]
    async fn search_field_stats(
        &self,
        Parameters(p): Parameters<FieldStatsParams>,
    ) -> Result<String, String> {
        let body = json!({
            "field": p.field,
            "hours": p.hours,
            "limit": p.limit,
            "time_from": p.time_from,
            "time_to": p.time_to,
            "query": p.query,
        });
        self.api
            .post("/v1/search/field-stats", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Fields populated in the current mPL filter scope")]
    async fn search_fields_in_scope(
        &self,
        Parameters(p): Parameters<FieldsInScopeParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "time_from": p.time_from,
            "time_to": p.time_to,
        });
        self.api
            .post("/v1/search/fields-in-scope", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Platform overview stats (events, alerts, rules)")]
    async fn overview(&self) -> Result<String, String> {
        self.api
            .get("/v1/overview", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List investigation cases")]
    async fn cases_list(
        &self,
        Parameters(p): Parameters<CasesListParams>,
    ) -> Result<String, String> {
        self.api
            .get(
                "/v1/cases",
                &[
                    ("status", p.status),
                    ("q", p.q),
                    ("owner", p.owner),
                ],
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Get one case by id")]
    async fn cases_get(
        &self,
        Parameters(p): Parameters<CaseIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/cases/{}", p.case_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Entity graph for a case")]
    async fn cases_entities(
        &self,
        Parameters(p): Parameters<CaseIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/cases/{}/entities", p.case_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Activity wall for a case")]
    async fn cases_wall(
        &self,
        Parameters(p): Parameters<CaseIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/cases/{}/wall", p.case_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Update case title, status, priority, device user, or tags")]
    async fn cases_patch(
        &self,
        Parameters(p): Parameters<CasesPatchParams>,
    ) -> Result<String, String> {
        let body = json!({
            "title": p.title,
            "description": p.description,
            "status": p.status,
            "priority": p.priority,
            "user": p.user,
            "tags": p.tags,
        });
        self.api
            .post(&format!("/v1/cases/{}", p.case_id), body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List alerts with optional filters")]
    async fn alerts_list(
        &self,
        Parameters(p): Parameters<AlertsListParams>,
    ) -> Result<String, String> {
        self.api
            .get(
                "/v1/alerts",
                &[
                    ("status", p.status),
                    ("dismissed", p.dismissed),
                    ("case_id", p.case_id),
                    ("assignee", p.assignee),
                ],
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Get alert detail including context JSON")]
    async fn alerts_get(
        &self,
        Parameters(p): Parameters<AlertIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/alerts/{}", p.alert_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Triage an alert — status, assignee, tags, comment, dismiss")]
    async fn alerts_patch(
        &self,
        Parameters(p): Parameters<AlertsPatchParams>,
    ) -> Result<String, String> {
        let body = json!({
            "status": p.status,
            "assignee": p.assignee,
            "tags": p.tags,
            "comment": p.comment,
            "dismissed": p.dismissed,
        });
        self.api
            .post(&format!("/v1/alerts/{}", p.alert_id), body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Link an alert to a case")]
    async fn cases_link_alert(
        &self,
        Parameters(p): Parameters<LinkAlertParams>,
    ) -> Result<String, String> {
        self.api
            .post(
                &format!("/v1/cases/{}/alerts/{}", p.case_id, p.alert_id),
                json!({}),
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Validate draft mPL before creating a detection rule")]
    async fn rules_validate_query(
        &self,
        Parameters(p): Parameters<ValidateQueryParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "mode": p.mode,
        });
        self.api
            .post("/v1/rules/validate-query", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List detection rules")]
    async fn rules_list(&self) -> Result<String, String> {
        self.api
            .get("/v1/rules", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List saved hunt queries")]
    async fn saved_queries_list(&self) -> Result<String, String> {
        self.api
            .get("/v1/saved-queries", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Create a saved hunt query")]
    async fn saved_queries_create(
        &self,
        Parameters(p): Parameters<SavedQueryCreateParams>,
    ) -> Result<String, String> {
        let body = json!({
            "name": p.name,
            "description": p.description,
            "query": p.query,
        });
        self.api
            .post("/v1/saved-queries", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Create a detection rule from mPL")]
    async fn rules_create(
        &self,
        Parameters(p): Parameters<RuleCreateParams>,
    ) -> Result<String, String> {
        let body = json!({
            "name": p.name,
            "description": p.description,
            "query": p.query,
            "severity": p.severity,
            "cron": p.cron,
            "lifecycle": p.lifecycle,
        });
        self.api
            .post("/v1/rules", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Fetch one event row by id")]
    async fn get_event(
        &self,
        Parameters(p): Parameters<EventIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/events/{}", p.event_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Rarity scatter for artefacts in an mPL scope (noise reduction)")]
    async fn prevalence_scatter(
        &self,
        Parameters(p): Parameters<PrevalenceScatterParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "time_from": p.time_from,
            "time_to": p.time_to,
            "max_device_count": p.max_device_count,
            "rarity_threshold": p.rarity_threshold,
        });
        self.api
            .post("/v1/prevalence/scatter", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Check whether server-side LLM assistant is configured")]
    async fn llm_status(&self) -> Result<String, String> {
        self.api
            .get("/v1/llm/status", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Data summary: ingested sources, event counts, parsers")]
    async fn data_summary(&self) -> Result<String, String> {
        self.api
            .get("/v1/data/summary", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(
        description = "Cold-archive an ingest source: clear ClickHouse events/alerts, keep blobs + case for re-ingest (requires data_admin)"
    )]
    async fn data_sources_archive(
        &self,
        Parameters(p): Parameters<SourceLabelParams>,
    ) -> Result<String, String> {
        self.api
            .post("/v1/data/sources/archive", json!({ "source": p.source }))
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(
        description = "Permanently delete an ingest source: events, cases, jobs, blobs (requires data_admin)"
    )]
    async fn data_sources_delete(
        &self,
        Parameters(p): Parameters<SourceLabelParams>,
    ) -> Result<String, String> {
        self.api
            .post("/v1/data/sources/delete", json!({ "source": p.source }))
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List ingest jobs (optional source filter)")]
    async fn ingest_jobs_list(
        &self,
        Parameters(p): Parameters<IngestJobsListParams>,
    ) -> Result<String, String> {
        self.api
            .get(
                "/v1/ingest/jobs",
                &[("source", p.source), ("limit", p.limit.map(|n| n.to_string()))],
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Get one ingest job by id (progress, stage, errors)")]
    async fn ingest_jobs_get(
        &self,
        Parameters(p): Parameters<IngestJobIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/ingest/jobs/{}", p.job_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Detailed health: ClickHouse, Postgres, ingest pool, MCP process")]
    async fn health_detail(&self) -> Result<String, String> {
        self.api
            .get("/v1/health/detail", &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Event count histogram over time for an mPL scope")]
    async fn search_histogram(
        &self,
        Parameters(p): Parameters<HistogramParams>,
    ) -> Result<String, String> {
        let body = json!({
            "query": p.query,
            "time_from": p.time_from,
            "time_to": p.time_to,
            "span_minutes": p.span_minutes,
        });
        self.api
            .post("/v1/search/histogram", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Create an investigation case")]
    async fn cases_create(
        &self,
        Parameters(p): Parameters<CasesCreateParams>,
    ) -> Result<String, String> {
        let body = json!({
            "title": p.title,
            "description": p.description,
            "status": p.status,
            "priority": p.priority,
            "user": p.user,
            "tags": p.tags,
        });
        self.api
            .post("/v1/cases", body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Add a comment to a case wall")]
    async fn cases_comment(
        &self,
        Parameters(p): Parameters<CasesCommentParams>,
    ) -> Result<String, String> {
        self.api
            .post(
                &format!("/v1/cases/{}/comments", p.case_id),
                json!({ "body": p.body, "note_type": p.note_type }),
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Get one detection rule by id")]
    async fn rules_get(
        &self,
        Parameters(p): Parameters<RuleIdParams>,
    ) -> Result<String, String> {
        self.api
            .get(&format!("/v1/rules/{}", p.rule_id), &[])
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Run a detection rule now (scheduled-style evaluation)")]
    async fn rules_run(
        &self,
        Parameters(p): Parameters<RuleIdParams>,
    ) -> Result<String, String> {
        self.api
            .post(&format!("/v1/rules/{}/run", p.rule_id), json!({}))
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Update a detection rule (partial fields)")]
    async fn rules_update(
        &self,
        Parameters(p): Parameters<RuleUpdateParams>,
    ) -> Result<String, String> {
        let body = json!({
            "name": p.name,
            "query": p.query,
            "description": p.description,
            "severity": p.severity,
            "cron": p.cron,
            "lifecycle": p.lifecycle,
            "enabled": p.enabled,
        });
        self.api
            .post(&format!("/v1/rules/{}", p.rule_id), body)
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "List stored collect archive blobs (optional source filter)")]
    async fn collect_blobs_list(
        &self,
        Parameters(p): Parameters<CollectBlobsListParams>,
    ) -> Result<String, String> {
        self.api
            .get(
                "/v1/collect/blobs",
                &[
                    ("source", p.source),
                    ("limit", p.limit.map(|n| n.to_string())),
                ],
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(
        description = "Re-ingest a stored collect blob into ClickHouse (clean=true clears existing events for that source first)"
    )]
    async fn collect_blobs_reingest(
        &self,
        Parameters(p): Parameters<CollectBlobReingestParams>,
    ) -> Result<String, String> {
        let clean = p.clean.unwrap_or(true);
        let path = format!(
            "/v1/collect/blobs/{}/reingest?clean={}",
            p.blob_id, clean
        );
        self.api
            .post(&path, json!({}))
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }

    #[tool(description = "Grouped alert summary (by rule / status)")]
    async fn alerts_groups(
        &self,
        Parameters(p): Parameters<AlertsGroupsParams>,
    ) -> Result<String, String> {
        self.api
            .get(
                "/v1/alerts/groups",
                &[("status", p.status), ("dismissed", p.dismissed)],
            )
            .await
            .map(|v| ok_json(&v))
            .map_err(|e| e.to_string())
    }
}

#[tool_handler(
    name = "mobipwn",
    version = "0.1.0",
    instructions = "MobiPwn MCP — mobile SIEM hunt, triage, and detection-as-code for external LLM agents. Use search_run with case-scoped mPL; read mobipwn://docs/* resources first."
)]
impl ServerHandler for MobiPwnMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, McpError> {
        Ok(ListResourcesResult {
            resources: vec![
                RawResource::new("mobipwn://docs/agents", "MobiPwn agents overview").no_annotation(),
                RawResource::new(
                    "mobipwn://docs/agents-crafting-searches",
                    "Crafting mPL searches with an agent",
                )
                .no_annotation(),
                RawResource::new("mobipwn://docs/mpl-language", "mPL language reference").no_annotation(),
                RawResource::new("mobipwn://docs/android-search", "Android hunt recipes").no_annotation(),
            ],
            next_cursor: None,
            meta: None,
        })
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, McpError> {
        let text = match request.uri.as_str() {
            "mobipwn://docs/agents" => DOC_AGENTS,
            "mobipwn://docs/agents-crafting-searches" => DOC_CRAFTING,
            "mobipwn://docs/mpl-language" => DOC_MPL,
            "mobipwn://docs/android-search" => DOC_ANDROID,
            _ => {
                return Err(McpError::resource_not_found(
                    "resource_not_found",
                    Some(json!({ "uri": request.uri })),
                ));
            }
        };
        Ok(ReadResourceResult::new(vec![ResourceContents::text(
            text,
            &request.uri,
        )]))
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, McpError> {
        Ok(ListPromptsResult {
            prompts: vec![
                Prompt::new(
                    "hunt",
                    Some("Draft and run mPL hunts on Android/iOS case data"),
                    Some(vec![
                        PromptArgument::new("question")
                            .with_description("Natural-language hunt question")
                            .with_required(true),
                        PromptArgument::new("case_source")
                            .with_description("Case source id, e.g. case-001")
                            .with_required(false),
                    ]),
                )
                .with_title("Mobile threat hunt"),
                Prompt::new(
                    "triage_alert",
                    Some("Investigate and triage a MobiPwn detection alert"),
                    Some(vec![PromptArgument::new("alert_id")
                        .with_description("Alert UUID")
                        .with_required(true)]),
                )
                .with_title("Triage alert"),
            ],
            next_cursor: None,
            meta: None,
        })
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResult, McpError> {
        let args = request.arguments.as_ref();
        let arg = |key: &str| -> Option<String> {
            args?.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        let messages = match request.name.as_str() {
            "hunt" => {
                let question = arg("question").unwrap_or_default();
                let case = arg("case_source");
                let case_line = case
                    .map(|c| format!("Scope to source=\"{c}\" unless cross-case IoC pivot is intended.\n"))
                    .unwrap_or_default();
                vec![PromptMessage::new_text(
                    PromptMessageRole::User,
                    format!(
                        "You are hunting on MobiPwn mobile SIEM data.\n\
                         {case_line}\
                         Read mobipwn://docs/agents-crafting-searches, mobipwn://docs/mpl-language, mobipwn://docs/android-search.\n\
                         Use mudm_list_fields / search_fields_in_scope, draft mPL, search_run with | head while iterating.\n\
                         To cut noise use prevalence_scatter. Save standing hunts with saved_queries_create.\n\n\
                         Hunt question: {question}"
                    ),
                )]
            }
            "triage_alert" => {
                let alert_id = arg("alert_id").unwrap_or_default();
                vec![PromptMessage::new_text(
                    PromptMessageRole::User,
                    format!(
                        "Triage MobiPwn alert {alert_id}.\n\
                         1. alerts_get for context\n\
                         2. Pivot with search_run on related bundle_id, installer, dest_ip, user\n\
                         3. Link to a case or update status via alerts_patch\n\
                         4. Suggest detection rule changes if false positive"
                    ),
                )]
            }
            _ => {
                return Err(McpError::invalid_params(
                    "unknown_prompt",
                    Some(json!({ "name": request.name })),
                ));
            }
        };

        Ok(GetPromptResult::new(messages))
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchRunParams {
    query: String,
    #[schemars(description = "ISO8601 lower bound")]
    time_from: Option<String>,
    #[schemars(description = "ISO8601 upper bound")]
    time_to: Option<String>,
    #[schemars(description = "Max rows (default 1000, capped by server)")]
    limit: Option<u32>,
    #[schemars(description = "Pagination token from prior search_run")]
    search_after: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchCompileParams {
    query: String,
    time_from: Option<String>,
    time_to: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct FieldStatsParams {
    field: String,
    hours: Option<u32>,
    limit: Option<u32>,
    time_from: Option<String>,
    time_to: Option<String>,
    query: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct FieldsInScopeParams {
    query: Option<String>,
    time_from: Option<String>,
    time_to: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CasesListParams {
    status: Option<String>,
    q: Option<String>,
    owner: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CaseIdParams {
    case_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CasesPatchParams {
    case_id: String,
    title: Option<String>,
    description: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    #[schemars(description = "Device owner (cases.user), not analyst assignee")]
    user: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct AlertsListParams {
    status: Option<String>,
    dismissed: Option<String>,
    case_id: Option<String>,
    assignee: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct AlertIdParams {
    alert_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct AlertsPatchParams {
    alert_id: String,
    status: Option<String>,
    assignee: Option<String>,
    tags: Option<Vec<String>>,
    comment: Option<String>,
    dismissed: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct LinkAlertParams {
    case_id: String,
    alert_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ValidateQueryParams {
    query: String,
    #[schemars(description = "scheduled or realtime")]
    mode: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SavedQueryCreateParams {
    name: String,
    description: Option<String>,
    query: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RuleCreateParams {
    name: String,
    query: String,
    description: Option<String>,
    #[schemars(description = "low, medium, high, critical")]
    severity: Option<String>,
    cron: Option<String>,
    lifecycle: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct EventIdParams {
    event_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct PrevalenceScatterParams {
    query: String,
    time_from: Option<String>,
    time_to: Option<String>,
    max_device_count: Option<u32>,
    rarity_threshold: Option<f64>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SourceLabelParams {
    #[schemars(description = "Ingest source label, e.g. case-001")]
    source: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct IngestJobsListParams {
    source: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct IngestJobIdParams {
    job_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct HistogramParams {
    query: String,
    time_from: Option<String>,
    time_to: Option<String>,
    #[schemars(description = "Bucket width in minutes")]
    span_minutes: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CasesCreateParams {
    title: String,
    description: Option<String>,
    status: Option<String>,
    priority: Option<String>,
    #[schemars(description = "Device owner")]
    user: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CasesCommentParams {
    case_id: String,
    body: String,
    #[schemars(description = "comment | note | finding")]
    note_type: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RuleIdParams {
    rule_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RuleUpdateParams {
    rule_id: String,
    name: Option<String>,
    query: Option<String>,
    description: Option<String>,
    severity: Option<String>,
    cron: Option<String>,
    lifecycle: Option<String>,
    enabled: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CollectBlobsListParams {
    source: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct CollectBlobReingestParams {
    blob_id: String,
    #[schemars(description = "Clear existing ClickHouse events for the blob source first (default true)")]
    clean: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct AlertsGroupsParams {
    status: Option<String>,
    dismissed: Option<String>,
}
