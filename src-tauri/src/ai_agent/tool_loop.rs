use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use git2::{Repository, Signature, Status, StatusOptions};
use ignore::WalkBuilder;
use serde_json::json;

use crate::ai::errors;
use crate::ai::redaction::redact_text;
use crate::ai_security::command_classifier::{classify_command, CommandClass};
use crate::ai_tools::registry;
use crate::ai_tools::{web_fetch, web_search};
use crate::commands::contracts::{
    AiApplyPatchMetadataRequest, AiApplyPatchRequest, AiContextReferencePayload,
    AiTaskPlanStepPayload,
};
use crate::commands::{
    configure_std_command_for_background, find_command_path, resolve_workspace_root,
};

const MAX_SCAN_FILES: usize = 800;
const MAX_TEXT_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 64 * 1024;
const TOOL_OUTPUT_HEAD_BYTES: usize = 12 * 1024;
const TOOL_OUTPUT_TAIL_BYTES: usize = 12 * 1024;
const RUN_TEST_TIMEOUT: Duration = Duration::from_secs(120);
const RUN_COMMAND_DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const RUN_COMMAND_MIN_TIMEOUT_MS: u64 = 1_000;
const RUN_COMMAND_MAX_TIMEOUT_MS: u64 = 120_000;
const RUN_COMMAND_PREVIEW_CHARS: usize = 160;
const MAX_TOOL_CALL_INPUT_REF_BYTES: usize = 8 * 1024;
const MAX_TOOL_RESULT_ITEMS: usize = 12;
const MAX_TOOL_RESULT_LINE_CHARS: usize = 240;

static TOOL_OUTPUT_REFS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn tool_output_refs() -> &'static Mutex<HashMap<String, String>> {
    TOOL_OUTPUT_REFS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone)]
pub struct AgentToolUseContext {
    pub run_id: String,
    pub step_id: String,
    pub permission_level: String,
    pub workspace_root: Option<String>,
    pub references: Vec<AiContextReferencePayload>,
    pub tool_decisions: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentToolCallMessage {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub tool_name: String,
    pub summary: String,
    pub input_ref: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentToolResultMessage {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub tool_name: String,
    pub status: String,
    pub requires_user_confirmation: bool,
    pub summary: String,
    pub output_ref: Option<String>,
    pub started_at: String,
    pub ended_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRunMessage {
    ToolCall(AgentToolCallMessage),
    ToolResult(AgentToolResultMessage),
}

pub trait AgentToolRuntimeServices: Send + Sync {
    fn auto_apply_patch(
        &self,
        payload: AiApplyPatchRequest,
        context: &AgentToolUseContext,
    ) -> Result<(String, Option<String>), String>;

    fn emit_tool_activity(
        &self,
        _context: &AgentToolUseContext,
        _tool_name: &str,
        _state: &str,
        _label: String,
    ) {
    }
}

pub fn validate_step_tools(step: &AiTaskPlanStepPayload) -> Result<(), String> {
    if step.tools.is_empty() {
        return Err(errors::error(
            "AI_AGENT_PLAN_INVALID",
            "Agent step must declare at least one registered tool.",
        ));
    }

    for tool_name in &step.tools {
        if !registry::is_tool_registered(tool_name) {
            return Err(errors::error(
                "AI_AGENT_TOOL_NOT_ALLOWED",
                "Agent step contains an unregistered tool and was rejected.",
            ));
        }
    }

    Ok(())
}

pub fn build_tool_result_messages(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
) -> Result<Vec<AgentRunMessage>, String> {
    build_tool_result_messages_with_services(context, step, None)
}

pub fn build_tool_result_messages_with_services(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> Result<Vec<AgentRunMessage>, String> {
    validate_step_tools(step)?;
    let workspace_root = resolve_workspace_root(context.workspace_root.clone())?;

    Ok(step
        .tools
        .iter()
        .map(|tool_name| {
            execute_registered_tool(context, step, tool_name, &workspace_root, services)
        })
        .collect())
}

pub fn build_tool_loop_messages_with_services(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> Result<Vec<AgentRunMessage>, String> {
    validate_step_tools(step)?;
    let workspace_root = resolve_workspace_root(context.workspace_root.clone())?;
    let mut messages = Vec::with_capacity(step.tools.len() * 2);

    for tool_name in &step.tools {
        emit_tool_activity(
            services,
            context,
            tool_name,
            "running",
            build_tool_activity_label(tool_name, step),
        );
        messages.push(build_tool_call_message(context, step, tool_name));
        let result = execute_registered_tool(context, step, tool_name, &workspace_root, services);
        if let AgentRunMessage::ToolResult(tool_result) = &result {
            let state = if tool_result.requires_user_confirmation {
                "waiting-confirmation"
            } else if tool_result.status == "succeeded" {
                "succeeded"
            } else {
                "failed"
            };
            emit_tool_activity(
                services,
                context,
                tool_name,
                state,
                tool_result.summary.clone(),
            );
        }
        messages.push(result);
    }

    Ok(messages)
}

fn emit_tool_activity(
    services: Option<&dyn AgentToolRuntimeServices>,
    context: &AgentToolUseContext,
    tool_name: &str,
    state: &str,
    label: String,
) {
    if let Some(services) = services {
        services.emit_tool_activity(context, tool_name, state, label);
    }
}

pub(crate) fn build_tool_activity_label(tool_name: &str, step: &AiTaskPlanStepPayload) -> String {
    let target = step
        .references
        .as_ref()
        .and_then(|items| items.first())
        .map(|reference| reference.label.trim())
        .filter(|label| !label.is_empty());

    match (tool_name, target) {
        ("read_current_file", Some(label)) | ("read_file", Some(label)) => {
            format!("正在读取 {label}…")
        }
        ("read_selected_text", _) => "正在读取当前选区…".to_string(),
        ("search_files", Some(label)) => format!("正在搜索文件名 {label}…"),
        ("search_files", None) => "正在搜索文件名…".to_string(),
        ("search_text", Some(label)) => format!("正在搜索项目内容 {label}…"),
        ("search_text", None) => "正在搜索项目内容…".to_string(),
        ("search_symbols", Some(label)) => format!("正在搜索符号 {label}…"),
        ("search_symbols", None) => "正在搜索符号…".to_string(),
        ("get_project_tree", _) => "正在读取项目结构…".to_string(),
        ("get_git_diff", _) => "正在读取 Git Diff…".to_string(),
        ("get_diagnostics", _) => "正在读取诊断信息…".to_string(),
        ("web_search", _) => "正在搜索…".to_string(),
        ("web_fetch", Some(label)) => format!("正在读取网页 {label}…"),
        ("web_fetch", None) => "正在读取网页…".to_string(),
        ("propose_patch", _) => "正在生成 patch…".to_string(),
        ("auto_apply_patch", _) => "正在应用 patch…".to_string(),
        ("run_test", _) => "正在运行测试…".to_string(),
        ("run_command", _) => "正在执行命令…".to_string(),
        ("stage_file", _) => "正在暂存文件…".to_string(),
        ("create_commit", _) => "正在创建本地提交…".to_string(),
        _ => format!("正在使用 {tool_name}…"),
    }
}

fn build_tool_call_message(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
    tool_name: &str,
) -> AgentRunMessage {
    let input_ref = build_tool_call_input_ref(tool_name, step);
    let created_at = chrono::Utc::now().to_rfc3339();

    AgentRunMessage::ToolCall(AgentToolCallMessage {
        id: format!("{}:{}:{}:call", context.run_id, context.step_id, tool_name),
        run_id: context.run_id.clone(),
        step_id: context.step_id.clone(),
        tool_name: tool_name.to_string(),
        summary: format!("Tool call requested: {tool_name}."),
        input_ref,
        created_at,
    })
}

fn build_tool_call_input_ref(tool_name: &str, step: &AiTaskPlanStepPayload) -> Option<String> {
    let input = step.tool_inputs.as_ref();
    let value = match tool_name {
        "web_search" => input
            .and_then(|items| items.web_search.as_ref())
            .map(|payload| {
                json!({
                    "query": redact_text(&payload.query).text,
                    "intent": payload.intent,
                    "maxResults": payload.max_results,
                    "recency": payload.recency,
                })
            }),
        "web_fetch" => input
            .and_then(|items| items.web_fetch.as_ref())
            .map(|payload| {
                json!({
                    "url": payload.url,
                    "reason": redact_text(&payload.reason).text,
                    "maxBytes": payload.max_bytes,
                })
            }),
        "propose_patch" => input
            .and_then(|items| items.propose_patch.as_ref())
            .map(|payload| {
                json!({
                    "path": payload.path,
                    "summary": redact_text(&payload.summary).text,
                    "originalBytes": payload.original_content.len(),
                    "updatedBytes": payload.updated_content.len(),
                })
            }),
        "auto_apply_patch" => {
            input
                .and_then(|items| items.auto_apply_patch.as_ref())
                .map(|payload| {
                    json!({
                        "summary": redact_text(&payload.patch.summary).text,
                        "fileCount": payload.patch.files.len(),
                        "files": payload
                            .patch
                            .files
                            .iter()
                            .map(|file| file.path.clone())
                            .collect::<Vec<_>>(),
                        "hasMetadata": payload.metadata.is_some(),
                    })
                })
        }
        "run_command" => input
            .and_then(|items| items.run_command.as_ref())
            .map(|payload| {
                json!({
                    "command": redact_text(&payload.command).text,
                    "reason": redact_text(&payload.reason).text,
                    "cwdPolicy": payload.cwd_policy,
                    "timeoutMs": payload.timeout_ms,
                })
            }),
        "stage_file" => input
            .and_then(|items| items.stage_file.as_ref())
            .map(|payload| {
                json!({
                    "pathCount": payload.paths.len(),
                    "paths": payload.paths,
                    "reason": redact_text(&payload.reason).text,
                })
            }),
        "create_commit" => input
            .and_then(|items| items.create_commit.as_ref())
            .map(|payload| {
                json!({
                    "message": redact_text(&payload.message).text,
                    "reason": redact_text(&payload.reason).text,
                    "allowEmpty": payload.allow_empty,
                })
            }),
        _ => Some(json!({
            "toolName": tool_name,
            "stepId": step.id,
            "hasStructuredInput": false,
        })),
    }?;

    let serialized = serde_json::to_string(&value).ok()?;
    let (content, was_truncated) = truncate_head_tail(&serialized, MAX_TOOL_CALL_INPUT_REF_BYTES);
    let ref_body = if was_truncated { content } else { serialized };

    Some(store_tool_output_ref("tool_call", &ref_body))
}

fn execute_registered_tool(
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
    tool_name: &str,
    workspace_root: &Path,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> AgentRunMessage {
    let started_at = chrono::Utc::now().to_rfc3339();
    let tool_requires_confirmation = registry::requires_confirmation(tool_name);
    let has_confirmation_decision = context.tool_decisions.contains_key(tool_name);
    let requires_user_confirmation = tool_requires_confirmation && !has_confirmation_decision;
    let execution = if tool_requires_confirmation {
        match context.tool_decisions.get(tool_name).map(String::as_str) {
            Some("skip") => ToolExecutionSummary {
                status: "succeeded".to_string(),
                summary: format!(
                    "Skipped {tool_name} by user decision; high-risk action was not executed."
                ),
                output_ref: None,
            },
            Some("allow-once") | Some("allow-run") => {
                execute_confirmed_high_risk_tool(tool_name, step, workspace_root, context, services)
            }
            Some("stop") => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("User stopped {tool_name}; tool was not executed."),
                output_ref: None,
            },
            _ => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Tool {tool_name} requires inline user confirmation."),
                output_ref: None,
            },
        }
    } else {
        match tool_name {
            "read_current_file" => {
                execute_current_file_reference(tool_name, &context.references, workspace_root)
            }
            "read_selected_text" => {
                execute_context_reference(tool_name, &context.references, &["selection"])
            }
            "read_file" => execute_read_file(step, &context.references, workspace_root),
            "get_diagnostics" => {
                execute_context_reference(tool_name, &context.references, &["diagnostics"])
            }
            "get_terminal_log" => {
                execute_context_reference(tool_name, &context.references, &["terminal-log"])
            }
            "search_text" => execute_search_text(step, workspace_root),
            "search_files" => execute_search_files(step, workspace_root),
            "search_symbols" => execute_search_symbols(step, workspace_root),
            "get_git_diff" => execute_get_git_diff(workspace_root),
            "web_search" | "web_fetch" => execute_network_gate(tool_name, step),
            "propose_patch" | "auto_apply_patch" => {
                execute_patch_gate(tool_name, step, context, services)
            }
            "run_test" => execute_run_test_gate(workspace_root),
            "run_command" => execute_confirmation_gate(
                tool_name,
                "command input and user confirmation are required",
            ),
            "stage_file" => {
                execute_confirmation_gate(tool_name, "file paths and Git confirmation are required")
            }
            "create_commit" => execute_confirmation_gate(
                tool_name,
                "commit message and Git confirmation are required",
            ),
            "get_project_tree" => execute_project_tree(workspace_root),
            "list_open_files" => execute_list_open_files(&context.references),
            "get_package_scripts" => execute_package_scripts(workspace_root),
            "get_test_targets" => execute_test_targets(workspace_root),
            _ => ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Tool {tool_name} is registered but has no executor."),
                output_ref: None,
            },
        }
    };
    let ended_at = chrono::Utc::now().to_rfc3339();

    AgentRunMessage::ToolResult(AgentToolResultMessage {
        id: format!(
            "{}:{}:{}:{}",
            context.run_id, context.step_id, tool_name, execution.status
        ),
        run_id: context.run_id.clone(),
        step_id: context.step_id.clone(),
        tool_name: tool_name.to_string(),
        status: execution.status,
        requires_user_confirmation,
        summary: execution.summary,
        output_ref: execution.output_ref,
        started_at,
        ended_at,
    })
}

fn execute_context_reference(
    tool_name: &str,
    references: &[AiContextReferencePayload],
    kinds: &[&str],
) -> ToolExecutionSummary {
    let matches = references
        .iter()
        .filter(|reference| kinds.contains(&reference.kind.as_str()))
        .collect::<Vec<_>>();

    if matches.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("Tool {tool_name} did not receive required frontend context."),
            output_ref: None,
        };
    }

    let preview_chars = matches
        .iter()
        .map(|reference| reference.content_preview.chars().count())
        .sum::<usize>();
    let labels = matches
        .iter()
        .take(3)
        .map(|reference| reference.label.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let output = matches
        .iter()
        .take(4)
        .map(|reference| {
            let path = reference.path.as_deref().unwrap_or("unknown");
            let range = reference
                .range
                .as_ref()
                .map(|item| format!("{}-{}", item.start_line, item.end_line))
                .unwrap_or_else(|| "summary".to_string());
            let preview = clip_tool_result_line(&reference.content_preview);
            format!(
                "[{}] {} ({path}, {range})\n{}",
                reference.kind, reference.label, preview
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Read {} context references ({preview_chars} preview chars): {labels}.",
            matches.len()
        ),
        output_ref: Some(store_tool_output(tool_name, output)),
    }
}

fn execute_current_file_reference(
    tool_name: &str,
    references: &[AiContextReferencePayload],
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(reference) = references
        .iter()
        .find(|reference| reference.kind == "current-file")
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("Tool {tool_name} did not receive current-file context."),
            output_ref: None,
        };
    };

    if let Some(raw_path) = reference.path.as_deref() {
        let path = Path::new(raw_path);
        let file_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            workspace_root.join(path)
        };

        if file_path.starts_with(workspace_root) && is_small_text_candidate(&file_path) {
            match fs::read_to_string(&file_path) {
                Ok(content) => {
                    let relative = relative_path(workspace_root, &file_path);
                    let output = format!(
                        "File: {relative}\nSize: {} bytes\n\n{}",
                        content.len(),
                        content
                    );
                    return ToolExecutionSummary {
                        status: "succeeded".to_string(),
                        summary: format!(
                            "Read current file content for {relative} ({} bytes).",
                            content.len()
                        ),
                        output_ref: Some(store_tool_output(tool_name, output)),
                    };
                }
                Err(error) => {
                    return ToolExecutionSummary {
                        status: "failed".to_string(),
                        summary: format!("read_current_file failed to read file content: {error}"),
                        output_ref: None,
                    };
                }
            }
        }
    }

    execute_context_reference(tool_name, references, &["current-file"])
}

fn execute_read_file(
    step: &AiTaskPlanStepPayload,
    references: &[AiContextReferencePayload],
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let candidates = collect_read_file_candidates(step, references);

    if candidates.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "read_file requires a file reference.".to_string(),
            output_ref: None,
        };
    }

    let mut last_failure = "read_file target does not exist.".to_string();

    for candidate in candidates {
        match resolve_workspace_read_path(candidate.raw_path, workspace_root) {
            Ok(file_path) => return read_workspace_file(&file_path, workspace_root),
            Err(error) => {
                last_failure = error.summary().to_string();
                if let Some(reference) = candidate.preview_reference {
                    if !reference.content_preview.trim().is_empty() {
                        return read_file_from_context_preview(reference, candidate.raw_path);
                    }
                }
            }
        }
    }

    ToolExecutionSummary {
        status: "failed".to_string(),
        summary: last_failure,
        output_ref: None,
    }
}

struct ReadFileCandidate<'a> {
    raw_path: &'a str,
    preview_reference: Option<&'a AiContextReferencePayload>,
}

enum ReadFilePathError {
    Empty,
    OutsideWorkspace,
    NotFound,
}

impl ReadFilePathError {
    fn summary(&self) -> &'static str {
        match self {
            Self::Empty => "read_file requires a non-empty file path.",
            Self::OutsideWorkspace => "read_file rejected a path outside workspace.",
            Self::NotFound => "read_file target does not exist.",
        }
    }
}

fn collect_read_file_candidates<'a>(
    step: &'a AiTaskPlanStepPayload,
    references: &'a [AiContextReferencePayload],
) -> Vec<ReadFileCandidate<'a>> {
    let mut explicit_candidates = Vec::new();

    if let Some(step_references) = step.references.as_ref() {
        for reference in step_references
            .iter()
            .filter(|reference| reference.r#type == "file")
        {
            let raw_path = reference.uri.trim();
            if raw_path.is_empty() {
                continue;
            }
            explicit_candidates.push(ReadFileCandidate {
                raw_path,
                preview_reference: find_matching_context_reference(raw_path, references),
            });
        }
    }

    if !explicit_candidates.is_empty() {
        return explicit_candidates;
    }

    references
        .iter()
        .filter(|reference| {
            matches!(
                reference.kind.as_str(),
                "current-file" | "selection" | "file"
            )
        })
        .filter_map(|reference| {
            let raw_path = reference.path.as_deref()?.trim();
            if raw_path.is_empty() {
                return None;
            }

            Some(ReadFileCandidate {
                raw_path,
                preview_reference: Some(reference),
            })
        })
        .collect()
}

fn find_matching_context_reference<'a>(
    raw_path: &str,
    references: &'a [AiContextReferencePayload],
) -> Option<&'a AiContextReferencePayload> {
    references.iter().find(|reference| {
        reference
            .path
            .as_deref()
            .is_some_and(|path| paths_loosely_match(raw_path, path))
    })
}

fn paths_loosely_match(left: &str, right: &str) -> bool {
    let left = normalize_path_hint(left);
    let right = normalize_path_hint(right);

    if left.is_empty() || right.is_empty() {
        return false;
    }

    left.eq_ignore_ascii_case(&right)
        || right.ends_with(&format!("/{left}"))
        || left.ends_with(&format!("/{right}"))
}

fn normalize_path_hint(path: &str) -> String {
    normalize_file_uri_path(path)
        .replace('\\', "/")
        .trim_matches('/')
        .to_lowercase()
}

fn normalize_file_uri_path(raw_path: &str) -> String {
    let trimmed = raw_path.trim();

    if let Some(rest) = trimmed.strip_prefix("file://") {
        if cfg!(windows) {
            return rest.trim_start_matches('/').to_string();
        }

        return format!("/{}", rest.trim_start_matches('/'));
    }

    trimmed.to_string()
}

fn resolve_workspace_read_path(
    raw_path: &str,
    workspace_root: &Path,
) -> Result<PathBuf, ReadFilePathError> {
    let normalized_path = normalize_file_uri_path(raw_path);
    let trimmed = normalized_path.trim();

    if trimmed.is_empty() {
        return Err(ReadFilePathError::Empty);
    }

    let path = Path::new(trimmed);
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        if path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err(ReadFilePathError::OutsideWorkspace);
        }

        workspace_root.join(path)
    };

    let canonical = candidate
        .canonicalize()
        .map_err(|_| ReadFilePathError::NotFound)?;

    if !canonical.starts_with(workspace_root) {
        return Err(ReadFilePathError::OutsideWorkspace);
    }

    Ok(canonical)
}

fn read_workspace_file(file_path: &Path, workspace_root: &Path) -> ToolExecutionSummary {
    let Ok(metadata) = fs::metadata(file_path) else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "read_file target does not exist.".to_string(),
            output_ref: None,
        };
    };
    let relative = relative_path(workspace_root, file_path);
    let output = if is_small_text_candidate(file_path) {
        let Ok(content) = fs::read_to_string(file_path) else {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("read_file failed to read {relative} as UTF-8 text."),
                output_ref: None,
            };
        };
        format!(
            "File: {relative}\nSize: {} bytes\n\n{}",
            metadata.len(),
            content
        )
    } else {
        format!(
            "File: {relative}\nSize: {} bytes\nBinary or large file preview is unavailable.",
            metadata.len()
        )
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Read file content for {} ({} bytes).",
            relative,
            metadata.len()
        ),
        output_ref: Some(store_tool_output("read_file", output)),
    }
}

fn read_file_from_context_preview(
    reference: &AiContextReferencePayload,
    requested_path: &str,
) -> ToolExecutionSummary {
    let path = reference.path.as_deref().unwrap_or(requested_path);
    let range = reference
        .range
        .as_ref()
        .map(|item| format!("{}-{}", item.start_line, item.end_line))
        .unwrap_or_else(|| "preview".to_string());
    let redaction = if reference.redacted {
        "\nRedacted: true"
    } else {
        ""
    };
    let output = format!(
        "File: {path}\nSource: frontend context preview\nRange: {range}{redaction}\n\n{}",
        reference.content_preview
    );

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Read file preview for {} from frontend context ({} preview chars).",
            reference.label,
            reference.content_preview.chars().count()
        ),
        output_ref: Some(store_tool_output("read_file", output)),
    }
}

fn execute_search_symbols(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step).to_lowercase();
    let mut scanned = 0usize;
    let mut matched = 0usize;
    let mut samples = Vec::new();

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }
        let path = entry.into_path();
        if !is_small_text_candidate(&path) {
            continue;
        }
        scanned += 1;
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for line in content.lines() {
            let normalized = line.trim().to_lowercase();
            if (normalized.starts_with("fn ")
                || normalized.starts_with("function ")
                || normalized.starts_with("const ")
                || normalized.starts_with("export const ")
                || normalized.contains("function "))
                && normalized.contains(&query)
            {
                matched += 1;
                if samples.len() < MAX_TOOL_RESULT_ITEMS {
                    samples.push(format!(
                        "{}: {}",
                        relative_path(workspace_root, &path),
                        clip_tool_result_line(line.trim())
                    ));
                }
            }
        }
    }
    let output = if samples.is_empty() {
        format!("No symbol-like matches found for query '{query}'.")
    } else {
        format!(
            "Symbol-like matches for query '{query}':\n{}",
            samples.join("\n")
        )
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Scanned {scanned} text files for symbol-like lines; matched {matched}."),
        output_ref: Some(store_tool_output("search_symbols", output)),
    }
}

fn execute_confirmed_high_risk_tool(
    tool_name: &str,
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
    context: &AgentToolUseContext,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> ToolExecutionSummary {
    match tool_name {
        "web_search" | "web_fetch" => execute_network_gate(tool_name, step),
        "propose_patch" | "auto_apply_patch" => {
            execute_patch_gate(tool_name, step, context, services)
        }
        "run_test" => execute_run_test_gate(workspace_root),
        "run_command" => execute_run_command_gate(step, workspace_root),
        "stage_file" => execute_stage_file_gate(step, workspace_root),
        "create_commit" => execute_create_commit_gate(step, workspace_root),
        _ => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "Tool {tool_name} has no confirmed executor for step {}.",
                step.id
            ),
            output_ref: None,
        },
    }
}

fn execute_network_gate(tool_name: &str, step: &AiTaskPlanStepPayload) -> ToolExecutionSummary {
    match tool_name {
        "web_search" => execute_web_search_gate(step),
        "web_fetch" => execute_web_fetch_gate(step),
        _ => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("Tool {tool_name} is not a network tool."),
            output_ref: None,
        },
    }
}

fn execute_web_search_gate(step: &AiTaskPlanStepPayload) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.web_search.clone())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "web_search was not executed: missing schema-validated search input."
                .to_string(),
            output_ref: None,
        };
    };

    match block_on_tool_future(web_search::search_confirmed(input)) {
        Ok(payload) => {
            let output = serde_json::to_string(&payload.results).unwrap_or_default();
            let output_ref = store_tool_output_ref("web_search", &output);
            ToolExecutionSummary {
                status: "succeeded".to_string(),
                summary: format!(
                    "web_search completed with {} result(s).",
                    payload.results.len()
                ),
                output_ref: Some(output_ref),
            }
        }
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("web_search failed: {error}"),
            output_ref: None,
        },
    }
}

fn execute_web_fetch_gate(step: &AiTaskPlanStepPayload) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.web_fetch.clone())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "web_fetch was not executed: missing schema-validated fetch input."
                .to_string(),
            output_ref: None,
        };
    };

    match block_on_tool_future(web_fetch::fetch_confirmed(input)) {
        Ok(payload) => ToolExecutionSummary {
            status: "succeeded".to_string(),
            summary: format!(
                "web_fetch completed for `{}` ({} bytes, textRef={}).",
                command_preview(&payload.source.url),
                payload.source.bytes,
                payload.source.text_ref
            ),
            output_ref: Some(payload.source.text_ref),
        },
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("web_fetch failed: {error}"),
            output_ref: None,
        },
    }
}

fn execute_patch_gate(
    tool_name: &str,
    step: &AiTaskPlanStepPayload,
    context: &AgentToolUseContext,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> ToolExecutionSummary {
    match tool_name {
        "propose_patch" => execute_propose_patch_gate(step),
        "auto_apply_patch" => execute_auto_apply_patch_gate(step, context, services),
        _ => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("Tool {tool_name} is not a patch tool."),
            output_ref: None,
        },
    }
}

fn execute_propose_patch_gate(step: &AiTaskPlanStepPayload) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.propose_patch.clone())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary:
                "propose_patch was not executed: missing schema-validated patch proposal input."
                    .to_string(),
            output_ref: None,
        };
    };

    match crate::ai_patch::propose_patch(input) {
        Ok(payload) => {
            let output = serde_json::to_string(&payload.patch).unwrap_or_default();
            let output_ref = store_tool_output_ref("propose_patch", &output);
            ToolExecutionSummary {
                status: "succeeded".to_string(),
                summary: format!(
                    "propose_patch generated patch for {} file(s): {}.",
                    payload.patch.files.len(),
                    command_preview(&payload.patch.summary)
                ),
                output_ref: Some(output_ref),
            }
        }
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("propose_patch failed: {error}"),
            output_ref: None,
        },
    }
}

fn execute_auto_apply_patch_gate(
    step: &AiTaskPlanStepPayload,
    context: &AgentToolUseContext,
    services: Option<&dyn AgentToolRuntimeServices>,
) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.auto_apply_patch.clone())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "auto_apply_patch was not executed: missing schema-validated AED patch input."
                .to_string(),
            output_ref: None,
        };
    };

    let Some(services) = services else {
        let output = serde_json::to_string(&input.patch).unwrap_or_default();
        let output_ref = store_tool_output_ref("auto_apply_patch", &output);
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "auto_apply_patch payload is ready for AED apply ({} file(s)), but no AED runtime service was provided.",
                input.patch.files.len()
            ),
            output_ref: Some(output_ref),
        };
    };

    let mut payload = input;
    payload.metadata = Some(normalize_auto_apply_metadata(
        payload.metadata,
        context,
        step,
    ));

    match services.auto_apply_patch(payload, context) {
        Ok((summary, output_ref)) => ToolExecutionSummary {
            status: "succeeded".to_string(),
            summary,
            output_ref,
        },
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("auto_apply_patch failed: {error}"),
            output_ref: None,
        },
    }
}

fn normalize_auto_apply_metadata(
    metadata: Option<AiApplyPatchMetadataRequest>,
    context: &AgentToolUseContext,
    step: &AiTaskPlanStepPayload,
) -> AiApplyPatchMetadataRequest {
    let mut metadata = metadata.unwrap_or(AiApplyPatchMetadataRequest {
        task_id: None,
        turn_id: None,
        reason: None,
        tool_call_id: None,
        confirmed_by_user: None,
        agent_run_id: None,
        agent_step_id: None,
    });

    if metadata.task_id.as_deref().is_none_or(str::is_empty) {
        metadata.task_id = Some(context.run_id.clone());
    }
    if metadata.turn_id.as_deref().is_none_or(str::is_empty) {
        metadata.turn_id = Some(step.id.clone());
    }
    if metadata.reason.as_deref().is_none_or(str::is_empty) {
        metadata.reason = Some(step.title.clone());
    }
    if metadata.tool_call_id.as_deref().is_none_or(str::is_empty) {
        metadata.tool_call_id = Some(format!("{}:{}:auto_apply_patch", context.run_id, step.id));
    }
    if metadata.confirmed_by_user.is_none() {
        metadata.confirmed_by_user = Some(true);
    }
    if metadata.agent_run_id.as_deref().is_none_or(str::is_empty) {
        metadata.agent_run_id = Some(context.run_id.clone());
    }
    if metadata.agent_step_id.as_deref().is_none_or(str::is_empty) {
        metadata.agent_step_id = Some(step.id.clone());
    }

    metadata
}

fn block_on_tool_future<F, T>(future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create tool runtime: {error}"))?
        .block_on(future)
}
fn execute_confirmation_gate(tool_name: &str, reason: &str) -> ToolExecutionSummary {
    ToolExecutionSummary {
        status: "failed".to_string(),
        summary: format!("Tool {tool_name} was not executed: {reason}."),
        output_ref: None,
    }
}

fn execute_run_command_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = extract_run_command_payload(step) else {
        let classification = classify_command("");
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command was not executed: missing schema-validated command payload. {}",
                classification.reason
            ),
            output_ref: None,
        };
    };

    if input.cwd_policy != "workspace-root" {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_command was not executed: cwdPolicy must be workspace-root.".to_string(),
            output_ref: None,
        };
    }

    if input.reason.trim().is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_command was not executed: reason is required.".to_string(),
            output_ref: None,
        };
    }

    let command = input.command.trim();
    let classification = classify_command(command);
    match classification.class {
        CommandClass::Blocked => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command blocked: {}{}",
                classification.reason,
                classification
                    .destructive_pattern
                    .map(|pattern| format!(" matched pattern: {pattern}."))
                    .unwrap_or_default()
            ),
            output_ref: None,
        },
        CommandClass::ReadOnly | CommandClass::Test => {
            let timeout = match resolve_run_command_timeout(input.timeout_ms) {
                Ok(timeout) => timeout,
                Err(error) => {
                    return ToolExecutionSummary {
                        status: "failed".to_string(),
                        summary: error,
                        output_ref: None,
                    };
                }
            };
            let parsed = match parse_command_for_execution(command) {
                Ok(parsed) => parsed,
                Err(error) => {
                    return ToolExecutionSummary {
                        status: "failed".to_string(),
                        summary: format!("run_command was not executed: {error}"),
                        output_ref: None,
                    };
                }
            };
            let Some(executable) = resolve_agent_command_executable(&parsed.executable) else {
                return ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!(
                        "run_command was not executed: executable '{}' was not found.",
                        parsed.executable
                    ),
                    output_ref: None,
                };
            };
            let args = parsed.args.iter().map(String::as_str).collect::<Vec<_>>();
            match run_command_with_timeout(&executable, &args, workspace_root, timeout) {
                Ok(result) => {
                    let output_ref = store_tool_output_ref("run_command", &result.output);
                    let status = if result.exit_code == Some(0) {
                        "succeeded"
                    } else {
                        "failed"
                    };
                    ToolExecutionSummary {
                        status: status.to_string(),
                        summary: format!(
                            "run_command executed Level {} command `{}`; exit={}; output={} bytes{}.",
                            classification.level,
                            command_preview(command),
                            result
                                .exit_code
                                .map(|code| code.to_string())
                                .unwrap_or_else(|| "timeout".to_string()),
                            result.output.len(),
                            if result.truncated { " (truncated/ref)" } else { "" }
                        ),
                        output_ref: Some(output_ref),
                    }
                }
                Err(error) => ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!(
                        "run_command failed to execute `{}`: {error}",
                        command_preview(command)
                    ),
                    output_ref: None,
                },
            }
        }
        CommandClass::ProjectScript | CommandClass::RequiresConfirmation => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!(
                "run_command refused to execute Level {} command `{}`. {}",
                classification.level,
                command_preview(command),
                classification.reason
            ),
            output_ref: None,
        },
    }
}

fn extract_run_command_payload(
    step: &AiTaskPlanStepPayload,
) -> Option<&crate::commands::contracts::AiRunCommandToolInputPayload> {
    step.tool_inputs.as_ref()?.run_command.as_ref()
}

fn resolve_run_command_timeout(timeout_ms: Option<u64>) -> Result<Duration, String> {
    let Some(timeout_ms) = timeout_ms else {
        return Ok(RUN_COMMAND_DEFAULT_TIMEOUT);
    };

    if !(RUN_COMMAND_MIN_TIMEOUT_MS..=RUN_COMMAND_MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "run_command was not executed: timeoutMs must be between {RUN_COMMAND_MIN_TIMEOUT_MS} and {RUN_COMMAND_MAX_TIMEOUT_MS}."
        ));
    }

    Ok(Duration::from_millis(timeout_ms))
}

fn parse_command_for_execution(command: &str) -> Result<ParsedAgentCommand, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("command is empty.".to_string());
    }

    if trimmed.chars().any(is_disallowed_shell_character) {
        return Err(
            "shell syntax is not supported; provide a simple executable plus arguments."
                .to_string(),
        );
    }

    let tokens = trimmed
        .split_whitespace()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let Some(executable) = tokens.first() else {
        return Err("command could not be tokenized.".to_string());
    };

    if executable.contains('/') || executable.contains('\\') || executable.contains(':') {
        return Err("executable must be resolved from PATH, not a direct path.".to_string());
    }

    Ok(ParsedAgentCommand {
        executable: executable.to_string(),
        args: tokens.into_iter().skip(1).collect(),
    })
}

fn is_disallowed_shell_character(character: char) -> bool {
    matches!(
        character,
        '|' | '&' | ';' | '<' | '>' | '`' | '$' | '(' | ')' | '{' | '}' | '"' | '\'' | '\n' | '\r'
    )
}

fn resolve_agent_command_executable(executable: &str) -> Option<std::path::PathBuf> {
    if executable.eq_ignore_ascii_case("pnpm") {
        return resolve_pnpm_command();
    }

    command_executable_candidates(executable)
        .into_iter()
        .find_map(|candidate| find_command_path(&candidate, &[]))
}

fn command_executable_candidates(executable: &str) -> Vec<String> {
    let name = executable.trim();
    if !cfg!(windows) || name.contains('.') {
        return vec![name.to_string()];
    }

    vec![
        format!("{name}.exe"),
        format!("{name}.cmd"),
        name.to_string(),
    ]
}

fn command_preview(command: &str) -> String {
    let normalized = command.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= RUN_COMMAND_PREVIEW_CHARS {
        return normalized;
    }

    let preview = normalized
        .chars()
        .take(RUN_COMMAND_PREVIEW_CHARS)
        .collect::<String>();
    format!("{preview}...")
}

struct ParsedAgentCommand {
    executable: String,
    args: Vec<String>,
}
fn execute_stage_file_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.stage_file.as_ref())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "stage_file was not executed: missing schema-validated file paths payload."
                .to_string(),
            output_ref: None,
        };
    };

    if input.reason.trim().is_empty() || input.paths.is_empty() || input.paths.len() > 32 {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary:
                "stage_file was not executed: reason is required and paths must contain 1~32 items."
                    .to_string(),
            output_ref: None,
        };
    }

    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to discover Git repository: {error}"),
                output_ref: None,
            };
        }
    };

    let workdir = repository.workdir().unwrap_or(workspace_root);
    let mut git_paths = Vec::new();
    for path in &input.paths {
        let path = match validate_stage_path(path, workspace_root, workdir) {
            Ok(path) => path,
            Err(error) => {
                return ToolExecutionSummary {
                    status: "failed".to_string(),
                    summary: format!("stage_file was not executed: {error}"),
                    output_ref: None,
                };
            }
        };
        git_paths.push(path);
    }

    let mut index = match repository.index() {
        Ok(index) => index,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to open Git index: {error}"),
                output_ref: None,
            };
        }
    };

    for path in &git_paths {
        if let Err(error) = index.add_path(path) {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("stage_file failed to stage {}: {error}", path.display()),
                output_ref: None,
            };
        }
    }

    if let Err(error) = index.write() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("stage_file failed to write Git index: {error}"),
            output_ref: None,
        };
    }

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "stage_file staged {} file(s): {}.",
            git_paths.len(),
            git_paths
                .iter()
                .take(5)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        output_ref: Some("agent-tool-result:stage-file".to_string()),
    }
}

fn execute_create_commit_gate(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let Some(input) = step
        .tool_inputs
        .as_ref()
        .and_then(|items| items.create_commit.as_ref())
    else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: missing schema-validated commit payload."
                .to_string(),
            output_ref: None,
        };
    };

    let message = input.message.trim();
    if message.is_empty() || input.reason.trim().is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: message and reason are required.".to_string(),
            output_ref: None,
        };
    }

    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to discover Git repository: {error}"),
                output_ref: None,
            };
        }
    };

    let mut index = match repository.index() {
        Ok(index) => index,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to open Git index: {error}"),
                output_ref: None,
            };
        }
    };

    if index.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: Git index is empty.".to_string(),
            output_ref: None,
        };
    }

    let tree_id = match index.write_tree() {
        Ok(tree_id) => tree_id,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to write tree: {error}"),
                output_ref: None,
            };
        }
    };
    let tree = match repository.find_tree(tree_id) {
        Ok(tree) => tree,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to load tree: {error}"),
                output_ref: None,
            };
        }
    };

    let parent = repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repository.find_commit(oid).ok());
    if parent
        .as_ref()
        .is_some_and(|commit| commit.tree_id() == tree_id)
        && input.allow_empty != Some(true)
    {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "create_commit was not executed: staged tree has no changes.".to_string(),
            output_ref: None,
        };
    }

    let signature = match repository
        .signature()
        .or_else(|_| Signature::now("AI Agent", "ai-agent@localhost"))
    {
        Ok(signature) => signature,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed to create signature: {error}"),
                output_ref: None,
            };
        }
    };
    let parents = parent.iter().collect::<Vec<_>>();
    let commit_id = match repository.commit(
        Some("HEAD"),
        &signature,
        &signature,
        message,
        &tree,
        &parents,
    ) {
        Ok(commit_id) => commit_id,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("create_commit failed: {error}"),
                output_ref: None,
            };
        }
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "create_commit created local commit {} with message `{}`.",
            commit_id,
            command_preview(message)
        ),
        output_ref: Some(format!("agent-tool-result:create-commit:{commit_id}")),
    }
}

fn validate_stage_path(
    value: &str,
    workspace_root: &Path,
    git_workdir: &Path,
) -> Result<PathBuf, String> {
    let trimmed = value.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("path is empty.".to_string());
    }
    let relative = Path::new(&trimmed);
    if relative.is_absolute()
        || relative.components().any(|item| {
            matches!(
                item,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err(format!(
            "path `{trimmed}` must be a relative workspace path."
        ));
    }
    if relative
        .components()
        .any(|item| matches!(item, Component::Normal(name) if name == ".git"))
    {
        return Err(format!("path `{trimmed}` targets .git and is not allowed."));
    }

    let absolute = workspace_root.join(relative);
    let canonical = absolute
        .canonicalize()
        .map_err(|error| format!("path `{trimmed}` must exist before staging: {error}"))?;
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    if !canonical.starts_with(&canonical_root) {
        return Err(format!("path `{trimmed}` is outside workspace."));
    }
    if canonical.is_dir() {
        return Err(format!(
            "path `{trimmed}` is a directory; stage files explicitly."
        ));
    }

    let canonical_git_workdir = git_workdir
        .canonicalize()
        .unwrap_or_else(|_| git_workdir.to_path_buf());
    canonical
        .strip_prefix(canonical_git_workdir)
        .map(Path::to_path_buf)
        .map_err(|_| format!("path `{trimmed}` is outside Git worktree."))
}
fn execute_run_test_gate(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    let test_scripts = scripts
        .iter()
        .filter(|script| script.0.contains("test"))
        .collect::<Vec<_>>();

    if test_scripts.is_empty() {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: "run_test found no package.json test script.".to_string(),
            output_ref: None,
        };
    }

    let selected = test_scripts
        .iter()
        .find(|script| script.0 == "test")
        .copied()
        .unwrap_or(test_scripts[0]);
    let command_ref = format!("pnpm run {}", selected.0);
    let Some(pnpm_path) = resolve_pnpm_command() else {
        return ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("{command_ref} was not executed: pnpm was not found."),
            output_ref: None,
        };
    };

    let execution = run_command_with_timeout(
        &pnpm_path,
        &["run", selected.0.as_str()],
        workspace_root,
        RUN_TEST_TIMEOUT,
    );

    match execution {
        Ok(result) => {
            let output_ref = store_tool_output_ref("run_test", &result.output);
            let status = if result.exit_code == Some(0) {
                "succeeded"
            } else {
                "failed"
            };
            ToolExecutionSummary {
                status: status.to_string(),
                summary: format!(
                    "{command_ref} completed: exit={}, output={} bytes{}.",
                    result
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "unknown".to_string()),
                    result.output.len(),
                    if result.truncated { " (truncated)" } else { "" }
                ),
                output_ref: Some(output_ref),
            }
        }
        Err(error) => ToolExecutionSummary {
            status: "failed".to_string(),
            summary: format!("{command_ref} failed: {error}"),
            output_ref: None,
        },
    }
}

fn execute_project_tree(workspace_root: &Path) -> ToolExecutionSummary {
    let mut files = 0usize;
    let mut directories = 0usize;
    let mut entries_preview = Vec::new();
    if let Ok(entries) = fs::read_dir(workspace_root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.file_type().is_ok_and(|file_type| file_type.is_dir()) {
                directories += 1;
                if entries_preview.len() < MAX_TOOL_RESULT_ITEMS {
                    entries_preview.push(format!("dir  {name}"));
                }
            } else {
                files += 1;
                if entries_preview.len() < MAX_TOOL_RESULT_ITEMS {
                    entries_preview.push(format!("file {name}"));
                }
            }
        }
    }
    let output = if entries_preview.is_empty() {
        "Project root is empty or inaccessible.".to_string()
    } else {
        format!("Top-level project entries:\n{}", entries_preview.join("\n"))
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Project tree root has {directories} directories and {files} files."),
        output_ref: Some(store_tool_output("get_project_tree", output)),
    }
}

fn execute_list_open_files(references: &[AiContextReferencePayload]) -> ToolExecutionSummary {
    let files = references
        .iter()
        .filter_map(|reference| reference.path.as_deref())
        .filter(|path| !path.trim().is_empty())
        .collect::<std::collections::BTreeSet<_>>();
    let output = if files.is_empty() {
        "No open or attached files were provided by the frontend.".to_string()
    } else {
        format!(
            "Open or attached files:\n{}",
            files
                .into_iter()
                .take(MAX_TOOL_RESULT_ITEMS)
                .collect::<Vec<_>>()
                .join("\n")
        )
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Detected {} open/attached file references.",
            references
                .iter()
                .filter_map(|reference| reference.path.as_deref())
                .filter(|path| !path.trim().is_empty())
                .collect::<std::collections::BTreeSet<_>>()
                .len()
        ),
        output_ref: Some(store_tool_output("list_open_files", output)),
    }
}

fn execute_package_scripts(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    let output = if scripts.is_empty() {
        "No package.json scripts were found.".to_string()
    } else {
        format!(
            "package.json scripts:\n{}",
            scripts
                .iter()
                .take(MAX_TOOL_RESULT_ITEMS)
                .map(|(name, command)| format!("{name}: {}", clip_tool_result_line(command)))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Found {} package scripts.", scripts.len()),
        output_ref: Some(store_tool_output("get_package_scripts", output)),
    }
}

fn execute_test_targets(workspace_root: &Path) -> ToolExecutionSummary {
    let scripts = package_scripts(workspace_root);
    let test_scripts = scripts
        .iter()
        .filter(|script| script.0.contains("test"))
        .map(|(name, command)| format!("{name}: {}", clip_tool_result_line(command)))
        .collect::<Vec<_>>();
    let test_count = test_scripts.len();
    let output = if test_scripts.is_empty() {
        "No test-related package scripts were found.".to_string()
    } else {
        format!(
            "Test-related package scripts:\n{}",
            test_scripts
                .into_iter()
                .take(MAX_TOOL_RESULT_ITEMS)
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Found {test_count} test-related package scripts."),
        output_ref: Some(store_tool_output("get_test_targets", output)),
    }
}

fn package_scripts(workspace_root: &Path) -> Vec<(String, String)> {
    let package_json = workspace_root.join("package.json");
    let Ok(content) = fs::read_to_string(package_json) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    let Some(scripts) = value.get("scripts").and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };

    scripts
        .iter()
        .filter_map(|(name, command)| {
            command
                .as_str()
                .map(|command| (name.clone(), command.to_string()))
        })
        .collect()
}

fn resolve_pnpm_command() -> Option<std::path::PathBuf> {
    if cfg!(windows) {
        find_command_path("pnpm.cmd", &[])
            .or_else(|| find_command_path("pnpm.exe", &[]))
            .or_else(|| find_command_path("pnpm", &[]))
    } else {
        find_command_path("pnpm", &[])
    }
}

fn run_command_with_timeout(
    executable: &Path,
    args: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<CommandExecution, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_std_command_for_background(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start command: {error}"))?;
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                break;
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let output = child.wait_with_output().map_err(|error| {
                        format!("failed to read timed-out command output: {error}")
                    })?;
                    let (output, truncated) =
                        normalize_command_output(output.stdout, output.stderr);
                    return Ok(CommandExecution {
                        exit_code: None,
                        output,
                        truncated,
                    });
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("failed to wait for command: {error}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to read command output: {error}"))?;
    let exit_code = output.status.code();
    let (output, truncated) = normalize_command_output(output.stdout, output.stderr);

    Ok(CommandExecution {
        exit_code,
        output,
        truncated,
    })
}

fn normalize_command_output(stdout: Vec<u8>, stderr: Vec<u8>) -> (String, bool) {
    let mut output = String::new();
    if !stdout.is_empty() {
        output.push_str("[stdout]\n");
        output.push_str(&String::from_utf8_lossy(&stdout));
    }
    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str("[stderr]\n");
        output.push_str(&String::from_utf8_lossy(&stderr));
    }

    truncate_head_tail(&output, MAX_TOOL_OUTPUT_BYTES)
}

fn truncate_head_tail(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }

    let head = take_prefix_at_char_boundary(value, TOOL_OUTPUT_HEAD_BYTES);
    let tail_start = value
        .len()
        .saturating_sub(TOOL_OUTPUT_TAIL_BYTES)
        .min(value.len());
    let tail_start = next_char_boundary(value, tail_start);
    let tail = &value[tail_start..];

    (
        format!(
            "{head}\n\n--- output truncated: {} bytes omitted ---\n\n{tail}",
            value.len().saturating_sub(head.len() + tail.len())
        ),
        true,
    )
}

fn take_prefix_at_char_boundary(value: &str, max_bytes: usize) -> &str {
    let end = previous_char_boundary(value, max_bytes.min(value.len()));
    &value[..end]
}

fn previous_char_boundary(value: &str, index: usize) -> usize {
    let mut cursor = index.min(value.len());
    while cursor > 0 && !value.is_char_boundary(cursor) {
        cursor -= 1;
    }
    cursor
}

fn next_char_boundary(value: &str, index: usize) -> usize {
    let mut cursor = index.min(value.len());
    while cursor < value.len() && !value.is_char_boundary(cursor) {
        cursor += 1;
    }
    cursor
}

fn clip_tool_result_line(value: &str) -> String {
    let clipped = value
        .chars()
        .take(MAX_TOOL_RESULT_LINE_CHARS)
        .collect::<String>();
    if value.chars().count() <= MAX_TOOL_RESULT_LINE_CHARS {
        clipped
    } else {
        format!("{clipped}...")
    }
}

fn store_tool_output(tool_name: &str, output: String) -> String {
    let (content, _) = truncate_head_tail(&output, MAX_TOOL_OUTPUT_BYTES);
    store_tool_output_ref(tool_name, &content)
}

fn store_tool_output_ref(tool_name: &str, output: &str) -> String {
    let id = format!(
        "agent-tool-output:{tool_name}:{}",
        chrono::Utc::now().timestamp_micros()
    );
    if let Ok(mut guard) = tool_output_refs().lock() {
        guard.insert(id.clone(), output.to_string());
    }
    id
}

pub fn load_tool_output_ref(ref_id: &str) -> Option<String> {
    tool_output_refs()
        .lock()
        .ok()
        .and_then(|guard| guard.get(ref_id).cloned())
}

struct CommandExecution {
    exit_code: Option<i32>,
    output: String,
    truncated: bool,
}

struct ToolExecutionSummary {
    status: String,
    summary: String,
    output_ref: Option<String>,
}

fn execute_search_files(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step);
    let normalized_query = query.to_lowercase();
    let mut scanned = 0usize;
    let mut matched = 0usize;
    let mut matches = Vec::new();

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        scanned += 1;
        let relative = relative_path(workspace_root, &entry.into_path());
        if relative.to_lowercase().contains(&normalized_query) {
            matched += 1;
            if matches.len() < MAX_TOOL_RESULT_ITEMS {
                matches.push(relative);
            }
        }
    }
    let output = if matches.is_empty() {
        format!("No file paths matched query '{query}'.")
    } else {
        format!(
            "Matched file paths for query '{query}':\n{}",
            matches.join("\n")
        )
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!("Scanned {scanned} file names; query '{query}' matched {matched} files."),
        output_ref: Some(store_tool_output("search_files", output)),
    }
}

fn execute_search_text(
    step: &AiTaskPlanStepPayload,
    workspace_root: &Path,
) -> ToolExecutionSummary {
    let query = derive_query(step);
    let normalized_query = query.to_lowercase();
    let mut scanned = 0usize;
    let mut matched_files = 0usize;
    let mut matched_lines = 0usize;
    let mut samples = Vec::new();

    for entry in WalkBuilder::new(workspace_root)
        .standard_filters(true)
        .hidden(false)
        .follow_links(false)
        .build()
        .filter_map(Result::ok)
    {
        if scanned >= MAX_SCAN_FILES {
            break;
        }
        if !entry
            .file_type()
            .is_some_and(|file_type| file_type.is_file())
        {
            continue;
        }

        let path = entry.into_path();
        if !is_small_text_candidate(&path) {
            continue;
        }
        scanned += 1;

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        let mut file_matched = false;
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&normalized_query) {
                matched_lines += 1;
                file_matched = true;
                if samples.len() < MAX_TOOL_RESULT_ITEMS {
                    samples.push(format!(
                        "{}:{}: {}",
                        relative_path(workspace_root, &path),
                        index + 1,
                        clip_tool_result_line(line.trim())
                    ));
                }
            }
        }
        if file_matched {
            matched_files += 1;
        }
    }
    let output = if samples.is_empty() {
        format!("No text matches found for query '{query}'.")
    } else {
        format!("Text matches for query '{query}':\n{}", samples.join("\n"))
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Scanned {scanned} text files; query '{query}' matched {matched_files} files / {matched_lines} lines."
        ),
        output_ref: Some(store_tool_output("search_text", output)),
    }
}

fn execute_get_git_diff(workspace_root: &Path) -> ToolExecutionSummary {
    let repository = match Repository::discover(workspace_root) {
        Ok(repository) => repository,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Failed to read Git status: {error}"),
                output_ref: None,
            };
        }
    };

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_ignored(false)
        .include_unmodified(false)
        .recurse_untracked_dirs(true);

    let statuses = match repository.statuses(Some(&mut options)) {
        Ok(statuses) => statuses,
        Err(error) => {
            return ToolExecutionSummary {
                status: "failed".to_string(),
                summary: format!("Failed to read Git diff summary: {error}"),
                output_ref: None,
            };
        }
    };

    let mut staged = 0usize;
    let mut unstaged = 0usize;
    let mut untracked = 0usize;
    let mut conflicted = 0usize;
    let mut samples = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let path = entry.path().unwrap_or("<unknown>");
        if status.contains(Status::CONFLICTED) {
            conflicted += 1;
            if samples.len() < MAX_TOOL_RESULT_ITEMS {
                samples.push(format!("conflicted {path}"));
            }
            continue;
        }
        if status.contains(Status::WT_NEW) && !status.contains(Status::INDEX_NEW) {
            untracked += 1;
            if samples.len() < MAX_TOOL_RESULT_ITEMS {
                samples.push(format!("untracked {path}"));
            }
            continue;
        }
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            staged += 1;
            if samples.len() < MAX_TOOL_RESULT_ITEMS {
                samples.push(format!("staged {path}"));
            }
        }
        if status.intersects(
            Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_RENAMED | Status::WT_TYPECHANGE,
        ) {
            unstaged += 1;
            if samples.len() < MAX_TOOL_RESULT_ITEMS {
                samples.push(format!("unstaged {path}"));
            }
        }
    }
    let output = if samples.is_empty() {
        "No changed files were detected in the Git workspace.".to_string()
    } else {
        format!("Git workspace changes:\n{}", samples.join("\n"))
    };

    ToolExecutionSummary {
        status: "succeeded".to_string(),
        summary: format!(
            "Git workspace summary: staged {staged}, unstaged {unstaged}, untracked {untracked}, conflicted {conflicted}."
        ),
        output_ref: Some(store_tool_output("get_git_diff", output)),
    }
}

fn derive_query(step: &AiTaskPlanStepPayload) -> String {
    let source = if step.title.trim().is_empty() {
        step.goal.as_str()
    } else {
        step.title.as_str()
    };
    let mut previous_was_space = false;
    let mut query = String::new();
    for character in source.chars() {
        if query.chars().count() >= 80 {
            break;
        }

        if character.is_alphanumeric() || matches!(character, '_' | '-' | '/' | '.') {
            query.push(character);
            previous_was_space = false;
            continue;
        }

        if character.is_whitespace() && !previous_was_space && !query.is_empty() {
            query.push(' ');
            previous_was_space = true;
        }
    }

    query = query.trim().to_string();

    if query.trim().is_empty() {
        query = "agent".to_string();
    }

    query
}

fn is_small_text_candidate(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return false;
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase());

    matches!(
        extension.as_deref(),
        Some(
            "rs" | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "vue"
                | "json"
                | "md"
                | "toml"
                | "yaml"
                | "yml"
                | "css"
                | "html"
                | "sh"
                | "bash"
        )
    )
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::{
        build_tool_activity_label, build_tool_loop_messages_with_services,
        build_tool_result_messages, build_tool_result_messages_with_services,
        load_tool_output_ref, truncate_head_tail, validate_step_tools, AgentRunMessage,
        AgentToolResultMessage, AgentToolRuntimeServices, AgentToolUseContext,
    };
    use crate::commands::contracts::{
        AiAgentToolInputsPayload, AiApplyPatchRequest, AiContextReferencePayload,
        AiCreateCommitToolInputPayload, AiPatchFilePayload, AiPatchHunkPayload, AiPatchSetPayload,
        AiProposePatchRequest, AiRunCommandToolInputPayload, AiStageFileToolInputPayload,
        AiTaskPlanReferencePayload, AiTaskPlanStepPayload,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::sync::Mutex;

    fn step_with_tools(tools: Vec<&str>) -> AiTaskPlanStepPayload {
        AiTaskPlanStepPayload {
            id: "step-1".to_string(),
            index: 0,
            title: "check tools".to_string(),
            goal: "check tools".to_string(),
            kind: "inspect".to_string(),
            status: "running".to_string(),
            expected_output: "tool validation result".to_string(),
            tools: tools.into_iter().map(ToOwned::to_owned).collect(),
            tool_inputs: None,
            references: None,
            is_active: Some(true),
            requires_user_approval: false,
            risk_level: "low".to_string(),
            rollback_strategy: None,
        }
    }

    fn context_reference(
        kind: &str,
        label: &str,
        path: Option<&str>,
        content_preview: &str,
    ) -> AiContextReferencePayload {
        AiContextReferencePayload {
            id: format!("ref-{kind}-{label}"),
            kind: kind.to_string(),
            label: label.to_string(),
            path: path.map(ToOwned::to_owned),
            range: None,
            content_preview: content_preview.to_string(),
            redacted: false,
        }
    }

    fn step_with_run_command(command: &str) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["run_command"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            web_search: None,
            web_fetch: None,
            propose_patch: None,
            auto_apply_patch: None,
            run_command: Some(AiRunCommandToolInputPayload {
                command: command.to_string(),
                reason: "unit test command execution".to_string(),
                cwd_policy: "workspace-root".to_string(),
                timeout_ms: Some(30_000),
            }),
            stage_file: None,
            create_commit: None,
        });
        step
    }

    fn step_with_stage_file(paths: Vec<&str>) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["stage_file"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            web_search: None,
            web_fetch: None,
            propose_patch: None,
            auto_apply_patch: None,
            run_command: None,
            stage_file: Some(AiStageFileToolInputPayload {
                paths: paths.into_iter().map(ToOwned::to_owned).collect(),
                reason: "unit test staging".to_string(),
            }),
            create_commit: None,
        });
        step
    }

    fn step_with_create_commit(message: &str) -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["create_commit"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            web_search: None,
            web_fetch: None,
            propose_patch: None,
            auto_apply_patch: None,
            run_command: None,
            stage_file: None,
            create_commit: Some(AiCreateCommitToolInputPayload {
                message: message.to_string(),
                reason: "unit test commit".to_string(),
                allow_empty: None,
            }),
        });
        step
    }

    fn step_with_propose_patch() -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["propose_patch"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            web_search: None,
            web_fetch: None,
            propose_patch: Some(AiProposePatchRequest {
                path: "script.sh".to_string(),
                original_content: "echo old".to_string(),
                updated_content: "echo new".to_string(),
                summary: "update script output".to_string(),
            }),
            auto_apply_patch: None,
            run_command: None,
            stage_file: None,
            create_commit: None,
        });
        step
    }

    fn step_with_auto_apply_patch() -> AiTaskPlanStepPayload {
        let mut step = step_with_tools(vec!["auto_apply_patch"]);
        step.tool_inputs = Some(AiAgentToolInputsPayload {
            web_search: None,
            web_fetch: None,
            propose_patch: None,
            auto_apply_patch: Some(AiApplyPatchRequest {
                patch: AiPatchSetPayload {
                    summary: "apply agent patch".to_string(),
                    files: vec![AiPatchFilePayload {
                        path: "src/App.vue".to_string(),
                        original_hash: "fnv64:0000000000000000".to_string(),
                        hunks: vec![AiPatchHunkPayload {
                            old_start: 1,
                            old_lines: 1,
                            new_start: 1,
                            new_lines: 1,
                            lines: vec!["-old".to_string(), "+new".to_string()],
                        }],
                    }],
                },
                metadata: None,
            }),
            run_command: None,
            stage_file: None,
            create_commit: None,
        });
        step
    }

    fn tool_result_at(messages: &[AgentRunMessage], index: usize) -> &AgentToolResultMessage {
        match &messages[index] {
            AgentRunMessage::ToolResult(result) => result,
            AgentRunMessage::ToolCall(_) => panic!("expected tool result at index {index}"),
        }
    }

    struct FakeAedRuntimeServices {
        captured_payload: Mutex<Option<AiApplyPatchRequest>>,
    }

    impl FakeAedRuntimeServices {
        fn new() -> Self {
            Self {
                captured_payload: Mutex::new(None),
            }
        }
    }

    impl AgentToolRuntimeServices for FakeAedRuntimeServices {
        fn auto_apply_patch(
            &self,
            payload: AiApplyPatchRequest,
            _context: &AgentToolUseContext,
        ) -> Result<(String, Option<String>), String> {
            let mut guard = self
                .captured_payload
                .lock()
                .map_err(|_| "fake AED service lock failed".to_string())?;
            *guard = Some(payload);
            Ok((
                "auto_apply_patch applied 1 file(s) through AED.".to_string(),
                Some("agent-tool-result:auto_apply_patch:run-1:step-1".to_string()),
            ))
        }
    }

    #[test]
    fn rejects_unknown_tool_before_execution() {
        let step = step_with_tools(vec!["unknown_tool"]);

        let error = validate_step_tools(&step).expect_err("unknown tool should be rejected");

        assert!(error.contains("AI_AGENT_TOOL_NOT_ALLOWED"));
    }

    #[test]
    fn creates_ref_only_tool_result_messages() {
        let step = step_with_tools(vec!["search_text"]);
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions: HashMap::new(),
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        assert_eq!(messages.len(), 1);
        let serialized = format!("{messages:?}");
        assert!(serialized.contains("search_text"));
        assert!(!serialized.contains("```"));
    }

    #[test]
    fn builds_readable_running_activity_label_for_search_tools() {
        let mut step = step_with_tools(vec!["search_text"]);
        step.references = Some(vec![AiTaskPlanReferencePayload {
            r#type: "file".to_string(),
            label: "AiAssistantPanel.vue".to_string(),
            uri: "src/components/business/ai/AiAssistantPanel.vue".to_string(),
        }]);

        let label = build_tool_activity_label("search_text", &step);

        assert_eq!(label, "正在搜索项目内容 AiAssistantPanel.vue…");
        assert!(!label.contains("正在校验工具"));
    }

    #[test]
    fn read_file_prefers_explicit_step_reference_over_current_file_context() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-read-file-explicit-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let src_dir = workspace_root.join("src");
        fs::create_dir_all(&src_dir).expect("workspace src should be created");
        fs::write(src_dir.join("current.ts"), "export const current = true;\n")
            .expect("current file should be written");
        fs::write(src_dir.join("target.ts"), "export const target = true;\n")
            .expect("target file should be written");
        let mut step = step_with_tools(vec!["read_file"]);
        step.references = Some(vec![AiTaskPlanReferencePayload {
            r#type: "file".to_string(),
            label: "target.ts".to_string(),
            uri: "src/target.ts".to_string(),
        }]);
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: vec![context_reference(
                "current-file",
                "current.ts",
                Some("src/current.ts"),
                "export const current = true;",
            )],
            tool_decisions: HashMap::new(),
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "read_file");
        assert_eq!(result.status, "succeeded");
        assert!(
            result.summary.contains("src/target.ts"),
            "{}",
            result.summary
        );
        let output = load_tool_output_ref(
            result
                .output_ref
                .as_deref()
                .expect("read_file should store output ref"),
        )
        .expect("output ref should be readable");
        let _ = fs::remove_dir_all(&workspace_root);
        assert!(output.contains("export const target = true;"));
        assert!(!output.contains("export const current = true;"));
    }

    #[test]
    fn read_file_uses_context_preview_when_path_cannot_resolve_inside_workspace() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-read-file-preview-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let step = step_with_tools(vec!["read_file"]);
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: vec![context_reference(
                "current-file",
                "AiAssistantPanel.vue",
                Some("/mnt/d/com.xiaojianc/my_desktop_app/src/components/business/ai/AiAssistantPanel.vue"),
                "const activeAgentFlowMessage = computed(() => 'preview');",
            )],
            tool_decisions: HashMap::new(),
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "read_file");
        assert_eq!(result.status, "succeeded");
        assert!(
            result.summary.contains("frontend context"),
            "{}",
            result.summary
        );
        let output = load_tool_output_ref(
            result
                .output_ref
                .as_deref()
                .expect("preview fallback should store output ref"),
        )
        .expect("output ref should be readable");
        let _ = fs::remove_dir_all(&workspace_root);
        assert!(output.contains("Source: frontend context preview"));
        assert!(output.contains("activeAgentFlowMessage"));
    }

    #[test]
    fn tool_loop_messages_include_tool_call_before_tool_result() {
        let step = step_with_propose_patch();
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("propose_patch".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages =
            build_tool_loop_messages_with_services(&context, &step, None).expect("messages");

        assert_eq!(messages.len(), 2);
        let AgentRunMessage::ToolCall(call) = &messages[0] else {
            panic!("first message should be tool call");
        };
        assert_eq!(call.tool_name, "propose_patch");
        assert!(call.input_ref.is_some());
        let AgentRunMessage::ToolResult(result) = &messages[1] else {
            panic!("second message should be tool result");
        };
        assert_eq!(result.tool_name, "propose_patch");
        assert_eq!(result.status, "succeeded");
        assert!(!format!("{messages:?}").contains("echo old"));
        assert!(!format!("{messages:?}").contains("echo new"));
    }

    #[test]
    fn confirmed_run_test_reaches_real_executor_gate() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-run-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let step = step_with_tools(vec!["run_test"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_test".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let _ = fs::remove_dir_all(&workspace_root);
        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "run_test");
        assert!(result.summary.contains("package.json test script"));
        assert!(!result.summary.contains("requires inline user confirmation"));
    }

    #[test]
    fn head_tail_truncation_keeps_utf8_boundaries() {
        let content = "测".repeat(30_000);

        let (truncated, was_truncated) = truncate_head_tail(&content, 1024);

        assert!(was_truncated);
        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(truncated.contains("output truncated"));
    }

    #[test]
    fn confirmed_run_command_requires_structured_payload() {
        let step = step_with_tools(vec!["run_command"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "run_command");
        assert_eq!(result.status, "failed");
        assert!(result.summary.contains("schema"));
        assert!(!result.summary.contains("闈欓粯鎴愬姛"));
    }
    #[test]
    fn confirmed_run_command_blocks_destructive_payload() {
        let step = step_with_run_command("git reset --hard HEAD");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "run_command");
        assert_eq!(result.status, "failed");
        assert!(result.summary.contains("blocked"));
        assert!(result.output_ref.is_none());
    }

    #[test]
    fn confirmed_run_command_executes_level_two_command() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-run-command-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let step = step_with_run_command("cargo test --help");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("run_command".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let _ = fs::remove_dir_all(&workspace_root);
        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "run_command");
        assert!(result.summary.contains("Level 2"));
        assert!(result.output_ref.is_some());
        assert!(!result.summary.contains("[stdout]"));
    }
    #[test]
    fn confirmed_stage_file_stages_existing_workspace_file() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-stage-file-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let repository = git2::Repository::init(&workspace_root).expect("repo should init");
        fs::write(workspace_root.join("tracked.txt"), "hello").expect("file should be written");
        let step = step_with_stage_file(vec!["tracked.txt"]);
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("stage_file".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let index = repository.index().expect("index should open");
        let _ = fs::remove_dir_all(&workspace_root);
        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "stage_file");
        assert_eq!(result.status, "succeeded", "{}", result.summary);
        assert!(result.summary.contains("staged 1"));
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn confirmed_create_commit_creates_local_commit_from_staged_file() {
        let workspace_root = std::env::temp_dir().join(format!(
            "calamex-agent-create-commit-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&workspace_root).expect("workspace should be created");
        let repository = git2::Repository::init(&workspace_root).expect("repo should init");
        fs::write(workspace_root.join("tracked.txt"), "hello").expect("file should be written");
        let mut index = repository.index().expect("index should open");
        index
            .add_path(std::path::Path::new("tracked.txt"))
            .expect("file should stage");
        index.write().expect("index should write");
        let step = step_with_create_commit("test: agent commit");
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("create_commit".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: Some(workspace_root.to_string_lossy().to_string()),
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let head = repository.head().expect("head should exist after commit");
        let _ = fs::remove_dir_all(&workspace_root);
        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "create_commit");
        assert_eq!(result.status, "succeeded");
        assert!(result.summary.contains("created local commit"));
        assert!(head.target().is_some());
    }
    #[test]
    fn confirmed_propose_patch_generates_patch_ref() {
        let step = step_with_propose_patch();
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("propose_patch".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "propose_patch");
        assert_eq!(result.status, "succeeded");
        assert!(result.summary.contains("generated patch"));
        assert!(result.output_ref.is_some());
    }

    #[test]
    fn confirmed_auto_apply_patch_fails_without_aed_service() {
        let step = step_with_auto_apply_patch();
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("auto_apply_patch".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };

        let messages = build_tool_result_messages(&context, &step).expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "auto_apply_patch");
        assert_eq!(result.status, "failed");
        assert!(result.summary.contains("no AED runtime service"));
        assert!(result.output_ref.is_some());
    }

    #[test]
    fn confirmed_auto_apply_patch_uses_aed_service_and_fills_metadata() {
        let step = step_with_auto_apply_patch();
        let mut tool_decisions = HashMap::new();
        tool_decisions.insert("auto_apply_patch".to_string(), "allow-once".to_string());
        let context = AgentToolUseContext {
            run_id: "run-1".to_string(),
            step_id: "step-1".to_string(),
            permission_level: "standard".to_string(),
            workspace_root: None,
            references: Vec::new(),
            tool_decisions,
        };
        let services = FakeAedRuntimeServices::new();

        let messages = build_tool_result_messages_with_services(&context, &step, Some(&services))
            .expect("messages");

        let result = tool_result_at(&messages, 0);
        assert_eq!(result.tool_name, "auto_apply_patch");
        assert_eq!(result.status, "succeeded");
        assert!(result.output_ref.is_some());

        let captured = services
            .captured_payload
            .lock()
            .expect("fake AED service should capture payload")
            .clone()
            .expect("payload should be captured");
        let metadata = captured.metadata.expect("metadata should be normalized");
        assert_eq!(metadata.task_id.as_deref(), Some("run-1"));
        assert_eq!(metadata.turn_id.as_deref(), Some("step-1"));
        assert_eq!(metadata.reason.as_deref(), Some("check tools"));
        assert_eq!(metadata.confirmed_by_user, Some(true));
        assert_eq!(metadata.agent_run_id.as_deref(), Some("run-1"));
        assert_eq!(metadata.agent_step_id.as_deref(), Some("step-1"));
    }

}
