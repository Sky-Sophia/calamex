use std::fmt;
use std::ops::Deref;

use serde::{Deserialize, Serialize};

// ============================================================================
// Secret newtype
// ----------------------------------------------------------------------------
// 用于在结构体中包裹敏感字符串（如 API Key），保证：
// - 在 JSON 上仍序列化/反序列化为普通字符串（serde transparent）；
// - {:?} / Debug 输出永远是 "***"，不会随 tracing/println 泄漏；
// - 通过 Deref<Target = str> 与 AsRef<str>，调用方对原 `String` 字段的绝大多数
//   只读用法（如 `&req.api_key` 当作 `&str`、`req.api_key.is_empty()`、
//   `req.api_key.len()`、`req.api_key.to_string()`）保持源码级兼容。
// ============================================================================
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretString(String);

impl SecretString {
    /// 显式取出明文，命名上提醒调用点这是一次"暴露密钥"的动作，便于审计。
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// 消费 `SecretString` 取回内部 `String`。
    pub fn into_inner(self) -> String {
        self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretString(***)")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl Deref for SecretString {
    type Target = str;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AsRef<str> for SecretString {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl From<String> for SecretString {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for SecretString {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl From<SecretString> for String {
    fn from(value: SecretString) -> Self {
        value.0
    }
}

// ============================================================================
// Script payloads
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFilePayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) content: String,
    pub(crate) encoding: String,
    pub(crate) line_count: usize,
    pub(crate) char_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAssetPayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) mime_type: String,
    pub(crate) data_url: String,
    pub(crate) byte_size: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveScriptRequest {
    pub(crate) path: String,
    pub(crate) content: String,
    /// 文本编码，已知值："utf-8" | "utf-8-bom" | "gbk" | …（保持字符串以便扩展）。
    pub(crate) encoding: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatScriptRequest {
    pub(crate) path: Option<String>,
    pub(crate) content: String,
    /// 文本编码，已知值："utf-8" | "utf-8-bom" | "gbk" | …。
    pub(crate) encoding: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatScriptPayload {
    pub(crate) content: String,
    pub(crate) encoding: String,
    pub(crate) line_count: usize,
    pub(crate) char_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeScriptRequest {
    pub(crate) path: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDiagnosticPayload {
    pub(crate) line: usize,
    pub(crate) end_line: usize,
    pub(crate) column: usize,
    pub(crate) end_column: usize,
    /// 严重程度，已知值："error" | "warning" | "info" | "hint"。
    pub(crate) level: String,
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeScriptPayload {
    pub(crate) available: bool,
    pub(crate) message: Option<String>,
    pub(crate) dialect: String,
    pub(crate) diagnostics: Vec<ScriptDiagnosticPayload>,
}

// ============================================================================
// Execution environment
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionOption {
    /// 执行器种类标识，例如："bash" | "zsh" | "pwsh" | "node" | …。
    pub(crate) r#type: String,
    pub(crate) label: String,
    pub(crate) available: bool,
    pub(crate) description: String,
    pub(crate) command_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEnvironment {
    pub(crate) recommended: String,
    pub(crate) has_any: bool,
    pub(crate) executors: Vec<ExecutionOption>,
}

// ============================================================================
// Workspace tree
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub(crate) path: String,
    pub(crate) name: String,
    /// 已知值："file" | "directory" | "symlink" | …。
    pub(crate) kind: String,
    pub(crate) has_children: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryPayload {
    pub(crate) root_path: String,
    pub(crate) root_name: String,
    pub(crate) entries: Vec<WorkspaceEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathCreateRequest {
    pub(crate) parent_path: String,
    pub(crate) root_path: String,
    pub(crate) name: String,
    /// 已知值："file" | "directory"。
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathCreatePayload {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRenameRequest {
    pub(crate) path: String,
    pub(crate) root_path: String,
    pub(crate) new_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathRenamePayload {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathDeleteRequest {
    pub(crate) path: String,
    pub(crate) root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePathDeletePayload {
    pub(crate) path: String,
}

// ============================================================================
// SSH
// ============================================================================
//
// 以下 *Request 共享一组连接字段（host/port/username/auth_mode/identity_path），
// 出于"零破坏性"约束本版未抽 SshCredentials + #[serde(flatten)]，未来若决定
// 重构，是 wire-compatible 的纯 Rust 内部改动。
//
// 注意：identity_path 在某些上下文下可能算敏感信息（包含本地用户名路径），
// 当前保留 Debug；若要进一步收紧可换成 `SecretString` 或自定义 Debug。

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    /// 已知值："password" | "key" | "agent"。
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionTestPayload {
    pub(crate) ok: bool,
    /// 已知值："ok" | "auth-failed" | "host-unreachable" | "timeout" | …。
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryEntryPayload {
    pub(crate) name: String,
    pub(crate) path: String,
    /// 已知值："file" | "directory" | "symlink"。
    pub(crate) kind: String,
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryListPayload {
    pub(crate) path: String,
    pub(crate) entries: Vec<SshDirectoryEntryPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileDownloadPayload {
    pub(crate) remote_path: String,
    pub(crate) local_path: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) local_path: String,
    pub(crate) remote_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshFileUploadPayload {
    pub(crate) local_path: String,
    pub(crate) remote_path: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeleteRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathDeletePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenameRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_path: String,
    pub(crate) new_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPathRenamePayload {
    pub(crate) old_path: String,
    pub(crate) new_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreateRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_mode: String,
    pub(crate) identity_path: Option<String>,
    pub(crate) remote_directory: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirectoryCreatePayload {
    pub(crate) remote_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHostPayload {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) username: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) identity_path: Option<String>,
    pub(crate) last_used_label: String,
}

// ============================================================================
// AI – chat
// ============================================================================

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessagePayload {
    /// 已知值："user" | "assistant" | "system" | "tool"。
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) references: Vec<AiContextReferencePayload>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextRangePayload {
    pub(crate) start_line: u32,
    pub(crate) end_line: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextReferencePayload {
    pub(crate) id: String,
    /// 引用种类，已知值："file" | "selection" | "symbol" | "diagnostic" | …。
    pub(crate) kind: String,
    pub(crate) label: String,
    pub(crate) path: Option<String>,
    pub(crate) range: Option<AiContextRangePayload>,
    pub(crate) content_preview: String,
    pub(crate) redacted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub(crate) thread_id: Option<String>,
    pub(crate) messages: Vec<AiChatMessagePayload>,
    pub(crate) references: Vec<AiContextReferencePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatPayload {
    pub(crate) message: AiChatMessagePayload,
    pub(crate) provider_type: String,
    pub(crate) model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatStreamPayload {
    pub(crate) stream_id: String,
    pub(crate) assistant_message_id: String,
    pub(crate) provider_type: String,
    pub(crate) model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCancelRequest {
    pub(crate) stream_id: String,
}

// ============================================================================
// AI – config / credentials
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSaveConfigRequest {
    pub(crate) provider_type: String,
    pub(crate) selected_model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) inline_completion_enabled: bool,
    pub(crate) chat_enabled: bool,
    pub(crate) agent_enabled: bool,
}

/// ⚠️ `api_key` 已包装在 `SecretString` 中，Debug 输出会被遮蔽为 `***`。
/// 调用方读取明文请使用 `request.api_key.expose()` 显式取出。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSaveCredentialsRequest {
    pub(crate) provider_type: String,
    pub(crate) api_key: SecretString,
}

/// 用于“测试连接 / 开始连接”的草稿配置。
///
/// `api_key` 允许为空：为空时后端只会尝试读取当前 Provider 已保存的凭证；
/// 若也不存在已保存凭证，连接测试必须失败，不能伪造成功。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConnectionRequest {
    pub(crate) provider_type: String,
    pub(crate) selected_model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) inline_completion_enabled: bool,
    pub(crate) chat_enabled: bool,
    pub(crate) agent_enabled: bool,
    pub(crate) api_key: Option<SecretString>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigPayload {
    pub(crate) provider_type: String,
    pub(crate) selected_model: Option<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) is_base_url_configured: bool,
    pub(crate) has_credentials: bool,
    pub(crate) is_configured: bool,
    pub(crate) inline_completion_enabled: bool,
    pub(crate) chat_enabled: bool,
    pub(crate) agent_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTestPayload {
    pub(crate) ok: bool,
    /// 已知值："ok" | "unauthorized" | "rate-limited" | "network" | …。
    pub(crate) code: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderConnectionPayload {
    pub(crate) config: AiConfigPayload,
    pub(crate) test: AiProviderTestPayload,
}

// ============================================================================
// AI – inline completion
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionRequest {
    pub(crate) file_path: String,
    pub(crate) language: String,
    pub(crate) cursor_offset: u32,
    pub(crate) prefix: String,
    pub(crate) suffix: String,
    pub(crate) recent_edits: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionRangePayload {
    pub(crate) start_offset: u32,
    pub(crate) end_offset: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineCompletionResult {
    pub(crate) insert_text: String,
    pub(crate) range: AiInlineCompletionRangePayload,
    /// 置信度等级，已知值："low" | "medium" | "high"。
    pub(crate) confidence: String,
}

// ============================================================================
// AI – code action / patch
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodeActionRequest {
    /// 已知值："explain" | "fix" | "refactor" | "test" | …。
    pub(crate) kind: String,
    pub(crate) file_path: Option<String>,
    pub(crate) language: String,
    pub(crate) selection: String,
    pub(crate) diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPatchHunkPayload {
    pub(crate) old_start: u32,
    pub(crate) old_lines: u32,
    pub(crate) new_start: u32,
    pub(crate) new_lines: u32,
    /// 统一 diff hunk 的原始行序列。每行首字符约定为：
    /// - `' '`（空格）：上下文行
    /// - `'+'`：新增行
    /// - `'-'`：删除行
    /// 行内不含末尾换行符，渲染端按需要补齐。
    pub(crate) lines: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPatchFilePayload {
    pub(crate) path: String,
    pub(crate) original_hash: String,
    pub(crate) hunks: Vec<AiPatchHunkPayload>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPatchSetPayload {
    pub(crate) summary: String,
    pub(crate) files: Vec<AiPatchFilePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCodeActionPayload {
    pub(crate) explanation: String,
    pub(crate) suggested_patch: Option<AiPatchSetPayload>,
    pub(crate) test_suggestion: Option<String>,
    pub(crate) follow_up_questions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProposePatchRequest {
    pub(crate) path: String,
    pub(crate) original_content: String,
    pub(crate) updated_content: String,
    pub(crate) summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProposePatchPayload {
    pub(crate) patch: AiPatchSetPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApplyPatchMetadataRequest {
    pub(crate) task_id: Option<String>,
    pub(crate) turn_id: Option<String>,
    pub(crate) reason: Option<String>,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) confirmed_by_user: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApplyPatchRequest {
    pub(crate) patch: AiPatchSetPayload,
    pub(crate) metadata: Option<AiApplyPatchMetadataRequest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApplyPatchFilePayload {
    pub(crate) path: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiApplyPatchPayload {
    pub(crate) applied_files: Vec<AiApplyPatchFilePayload>,
}

// ============================================================================
// AI – edit / timeline / auth
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditSetAuthLevelRequest {
    /// 已知值："manual" | "per_task" | "session"。
    pub(crate) level: String,
    pub(crate) task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditAuthStatePayload {
    /// 已知值："manual" | "per_task" | "session"。
    pub(crate) level: String,
    pub(crate) task_id: Option<String>,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditOperationPayload {
    pub(crate) id: String,
    pub(crate) task_id: String,
    pub(crate) turn_id: String,
    /// 已知值："create" | "modify" | "delete" | "rename"。
    pub(crate) kind: String,
    pub(crate) path: String,
    pub(crate) new_path: Option<String>,
    pub(crate) source_snapshot_id: Option<String>,
    pub(crate) before_hash: Option<String>,
    pub(crate) after_hash: Option<String>,
    pub(crate) bytes_before: Option<u64>,
    pub(crate) bytes_after: Option<u64>,
    pub(crate) applied_at: String,
    pub(crate) reason: String,
    pub(crate) tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSnapshotPayload {
    pub(crate) id: String,
    /// 已知值："task-start" | "turn-start" | "pre-tool" | "manual"
    /// | "pre-revert" | "revert"。
    pub(crate) scope: String,
    pub(crate) task_id: String,
    pub(crate) created_at: String,
    pub(crate) label: String,
    pub(crate) file_refs: Vec<String>,
    pub(crate) storage_key: String,
    pub(crate) size_bytes: u64,
}

/// 与前端 `aiEditTimelineEntrySchema` 一一对齐的判别联合，
/// 形如 `{ "type": "snapshot" | "operation", "data": { … } }`。
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum AiEditTimelineEntryPayload {
    Snapshot(AiSnapshotPayload),
    Operation(AiEditOperationPayload),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditListTimelineRequest {
    pub(crate) task_id: Option<String>,
    pub(crate) limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditListTimelinePayload {
    pub(crate) entries: Vec<AiEditTimelineEntryPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditRestoreSnapshotRequest {
    pub(crate) snapshot_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditRestoreSnapshotPayload {
    pub(crate) snapshot_id: String,
    pub(crate) restored_files: Vec<String>,
    pub(crate) pre_revert_snapshot: AiSnapshotPayload,
    pub(crate) restored_snapshot: AiSnapshotPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditUndoOperationRequest {
    pub(crate) operation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditUndoOperationPayload {
    pub(crate) operation_id: String,
    pub(crate) restored_files: Vec<String>,
    pub(crate) pre_revert_snapshot: AiSnapshotPayload,
    pub(crate) restored_snapshot: AiSnapshotPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditRevertTaskRequest {
    pub(crate) task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditRevertTaskPayload {
    pub(crate) task_id: String,
    pub(crate) reverted_operation_ids: Vec<String>,
    pub(crate) restored_files: Vec<String>,
    pub(crate) pre_revert_snapshots: Vec<AiSnapshotPayload>,
    pub(crate) restored_snapshots: Vec<AiSnapshotPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolDefinitionPayload {
    pub(crate) name: String,
    pub(crate) read_only: bool,
    pub(crate) destructive: bool,
    pub(crate) requires_confirmation: bool,
}

// ============================================================================
// AI – agent plan / index
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentPlanRequest {
    pub(crate) goal: String,
    pub(crate) context: Vec<AiContextReferencePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskPlanStepPayload {
    pub(crate) id: String,
    pub(crate) title: String,
    /// 已知值："pending" | "in-progress" | "done" | "failed" | "skipped"。
    pub(crate) status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentPlanPayload {
    pub(crate) steps: Vec<AiTaskPlanStepPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBuildIndexRequest {
    pub(crate) workspace_root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBuildIndexPayload {
    pub(crate) root_path: String,
    pub(crate) indexed_file_count: usize,
    pub(crate) skipped_file_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueryIndexRequest {
    pub(crate) workspace_root_path: String,
    pub(crate) query: String,
    pub(crate) limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiIndexResultPayload {
    pub(crate) path: String,
    pub(crate) line_number: Option<usize>,
    pub(crate) preview: String,
    pub(crate) score: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueryIndexPayload {
    pub(crate) root_path: String,
    pub(crate) results: Vec<AiIndexResultPayload>,
}
