use std::{env, path::PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const TERMINAL_RUN_SCRIPT_KIND: &str = "terminal.runScript.v1";
pub const TERMINAL_RUN_STARTED_KIND: &str = "terminal.runStarted.v1";
pub const TERMINAL_RUN_CHUNK_KIND: &str = "terminal.runChunk.v1";
pub const TERMINAL_RUN_COMPLETED_KIND: &str = "terminal.runCompleted.v1";
pub const TERMINAL_RUN_ERROR_KIND: &str = "terminal.runError.v1";
pub const TERMINAL_RUN_INPUT_KIND: &str = "terminal.runInput.v1";
pub const TERMINAL_OPEN_INTERACTIVE_KIND: &str = "terminal.openInteractive.v1";
pub const TERMINAL_INTERACTIVE_OPENED_KIND: &str = "terminal.interactiveOpened.v1";
pub const TERMINAL_INTERACTIVE_INPUT_KIND: &str = "terminal.interactiveInput.v1";
pub const TERMINAL_INTERACTIVE_RESIZE_KIND: &str = "terminal.interactiveResize.v1";
pub const TERMINAL_INTERACTIVE_CLOSE_KIND: &str = "terminal.interactiveClose.v1";
pub const TERMINAL_INTERACTIVE_SIGNAL_PROCESS_KIND: &str = "terminal.signalProcess.v1";
pub const TERMINAL_INTERACTIVE_DATA_KIND: &str = "terminal.interactiveData.v1";
pub const TERMINAL_INTERACTIVE_CLOSED_KIND: &str = "terminal.interactiveClosed.v1";
pub const TERMINAL_INTERACTIVE_ACK_KIND: &str = "terminal.interactiveAck.v1";
pub const TERMINAL_INTERACTIVE_ERROR_KIND: &str = "terminal.interactiveError.v1";

// 改动 3: 把 signal mode 字面量提到常量,作为协议层唯一可信来源。
pub const SIGNAL_MODE_GRACEFUL: &str = "graceful";
pub const SIGNAL_MODE_KILL: &str = "kill";

#[derive(Debug, Error)]
pub enum WslLinkTerminalExecError {
    #[error("WSL Link terminal payload 无效：{0}")]
    Payload(String),
    #[error("WSL Link terminal payload 序列化失败：{0}")]
    Serde(#[from] serde_json::Error),
    #[error("WSL Link terminal 工作目录无效：{0}")]
    InvalidWorkingDirectory(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunScriptRequest {
    pub run_id: String,
    pub working_directory: String,
    pub execution_path: String,
    pub script_content: Option<String>,
    pub cleanup_paths: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

impl WslLinkTerminalRunScriptRequest {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        // 改动 1: helper 化空值校验;错误消息与原版字符串等价。
        ensure_field_non_empty(&self.run_id, "run_id")?;
        ensure_field_non_empty(&self.working_directory, "working_directory")?;
        ensure_field_non_empty(&self.execution_path, "execution_path")?;
        // 改动 2: 复用 validate_terminal_size,消除字面重复。
        validate_terminal_size(self.cols, self.rows)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalOpenInteractiveRequest {
    pub session_id: String,
    pub working_directory: String,
    pub cols: u16,
    pub rows: u16,
}

impl WslLinkTerminalOpenInteractiveRequest {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        ensure_field_non_empty(&self.session_id, "session_id")?;
        ensure_field_non_empty(&self.working_directory, "working_directory")?;
        validate_terminal_size(self.cols, self.rows)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunInput {
    pub run_id: String,
    pub data: String,
}

impl WslLinkTerminalRunInput {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        ensure_field_non_empty(&self.run_id, "run_id")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveInput {
    pub session_id: String,
    pub data: String,
}

impl WslLinkTerminalInteractiveInput {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        ensure_field_non_empty(&self.session_id, "session_id")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveResize {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

impl WslLinkTerminalInteractiveResize {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        ensure_field_non_empty(&self.session_id, "session_id")?;
        validate_terminal_size(self.cols, self.rows)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveClose {
    pub session_id: String,
}

impl WslLinkTerminalInteractiveClose {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        ensure_field_non_empty(&self.session_id, "session_id")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalSignalProcess {
    pub pid: u32,
    pub mode: String,
}

impl WslLinkTerminalSignalProcess {
    pub fn validate(&self) -> Result<(), WslLinkTerminalExecError> {
        if self.pid == 0 {
            return Err(WslLinkTerminalExecError::Payload(
                "pid 必须有效。".to_string(),
            ));
        }
        // 改动 3: 用 SIGNAL_MODE_* 常量取代 magic string。
        let mode = self.mode.trim();
        if mode != SIGNAL_MODE_GRACEFUL && mode != SIGNAL_MODE_KILL {
            return Err(WslLinkTerminalExecError::Payload(format!(
                "mode 只能是 {SIGNAL_MODE_GRACEFUL} 或 {SIGNAL_MODE_KILL}。"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunStarted {
    pub run_id: String,
    pub pid: u32,
    pub started_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunChunk {
    pub run_id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunCompleted {
    pub run_id: String,
    pub exit_code: Option<i32>,
    pub finished_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalRunError {
    pub run_id: String,
    pub message: String,
    pub exit_code: Option<i32>,
    pub finished_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveOpened {
    pub session_id: String,
    pub cwd: String,
    pub pid: u32,
    pub opened_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveData {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveClosed {
    pub session_id: String,
    pub exit_code: Option<i32>,
    pub finished_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveAck {
    pub session_id: Option<String>,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslLinkTerminalInteractiveError {
    pub session_id: Option<String>,
    pub message: String,
    pub exit_code: Option<i32>,
    pub finished_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WslLinkTerminalClientPayload {
    #[serde(rename = "terminal.runScript.v1")]
    RunScript(WslLinkTerminalRunScriptRequest),
    #[serde(rename = "terminal.runInput.v1")]
    RunInput(WslLinkTerminalRunInput),
    #[serde(rename = "terminal.openInteractive.v1")]
    OpenInteractive(WslLinkTerminalOpenInteractiveRequest),
    #[serde(rename = "terminal.interactiveInput.v1")]
    InteractiveInput(WslLinkTerminalInteractiveInput),
    #[serde(rename = "terminal.interactiveResize.v1")]
    InteractiveResize(WslLinkTerminalInteractiveResize),
    #[serde(rename = "terminal.interactiveClose.v1")]
    InteractiveClose(WslLinkTerminalInteractiveClose),
    #[serde(rename = "terminal.signalProcess.v1")]
    SignalProcess(WslLinkTerminalSignalProcess),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WslLinkTerminalServerPayload {
    #[serde(rename = "terminal.runStarted.v1")]
    RunStarted(WslLinkTerminalRunStarted),
    #[serde(rename = "terminal.runChunk.v1")]
    RunChunk(WslLinkTerminalRunChunk),
    #[serde(rename = "terminal.runCompleted.v1")]
    RunCompleted(WslLinkTerminalRunCompleted),
    #[serde(rename = "terminal.runError.v1")]
    RunError(WslLinkTerminalRunError),
    #[serde(rename = "terminal.interactiveOpened.v1")]
    InteractiveOpened(WslLinkTerminalInteractiveOpened),
    #[serde(rename = "terminal.interactiveData.v1")]
    InteractiveData(WslLinkTerminalInteractiveData),
    #[serde(rename = "terminal.interactiveClosed.v1")]
    InteractiveClosed(WslLinkTerminalInteractiveClosed),
    #[serde(rename = "terminal.interactiveAck.v1")]
    InteractiveAck(WslLinkTerminalInteractiveAck),
    #[serde(rename = "terminal.interactiveError.v1")]
    InteractiveError(WslLinkTerminalInteractiveError),
}

pub fn encode_terminal_client_payload(
    payload: &WslLinkTerminalClientPayload,
) -> Result<Vec<u8>, WslLinkTerminalExecError> {
    Ok(serde_json::to_vec(payload)?)
}

pub fn decode_terminal_client_payload(
    payload: &[u8],
) -> Result<WslLinkTerminalClientPayload, WslLinkTerminalExecError> {
    serde_json::from_slice(payload).map_err(Into::into)
}

pub fn encode_terminal_server_payload(
    payload: &WslLinkTerminalServerPayload,
) -> Result<Vec<u8>, WslLinkTerminalExecError> {
    Ok(serde_json::to_vec(payload)?)
}

pub fn decode_terminal_server_payload(
    payload: &[u8],
) -> Result<WslLinkTerminalServerPayload, WslLinkTerminalExecError> {
    serde_json::from_slice(payload).map_err(Into::into)
}

pub fn resolve_agent_working_directory(value: &str) -> Result<PathBuf, WslLinkTerminalExecError> {
    let trimmed = value.trim();
    if trimmed == "~" {
        return home_directory();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return Ok(home_directory()?.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

fn home_directory() -> Result<PathBuf, WslLinkTerminalExecError> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| WslLinkTerminalExecError::InvalidWorkingDirectory("HOME 未设置。".into()))
}

// 改动 1: 集中实现 trim().is_empty() 空值校验,错误消息与各处原版字符串等价。
fn ensure_field_non_empty(
    value: &str,
    field: &'static str,
) -> Result<(), WslLinkTerminalExecError> {
    if value.trim().is_empty() {
        return Err(WslLinkTerminalExecError::Payload(format!(
            "{field} 不能为空。"
        )));
    }
    Ok(())
}

fn validate_terminal_size(cols: u16, rows: u16) -> Result<(), WslLinkTerminalExecError> {
    if cols < 2 || rows < 1 {
        return Err(WslLinkTerminalExecError::Payload(
            "终端尺寸必须有效。".to_string(),
        ));
    }
    Ok(())
}

#[derive(Default)]
pub struct WslLinkUtf8ChunkDecoder {
    pending: Vec<u8>,
}

impl WslLinkUtf8ChunkDecoder {
    pub fn decode_into(&mut self, input: &[u8], output: &mut String, last: bool) {
        if !input.is_empty() {
            self.pending.extend_from_slice(input);
        }
        loop {
            if self.pending.is_empty() {
                return;
            }
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        // 改动 4: valid_up_to 由 Utf8Error 保证 [..valid_up_to] 是合法 UTF-8,
                        // 这里不存在 Err 分支;使用 expect 让契约显式,避免 if-let 误导读者
                        // 以为有静默错误路径需要处理。
                        let valid_prefix = std::str::from_utf8(&self.pending[..valid_up_to])
                            .expect("valid_up_to guarantees the prefix is valid UTF-8");
                        output.push_str(valid_prefix);
                        self.pending.drain(..valid_up_to);
                        continue;
                    }
                    if let Some(error_len) = error.error_len() {
                        output.push('\u{FFFD}');
                        self.pending.drain(..error_len);
                        continue;
                    }
                    if last {
                        output.push('\u{FFFD}');
                        self.pending.clear();
                    }
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_payload_roundtrips_chinese_and_emoji() {
        let payload = WslLinkTerminalClientPayload::RunScript(WslLinkTerminalRunScriptRequest {
            run_id: "run-1".to_string(),
            working_directory: "~/项目".to_string(),
            execution_path: "/tmp/脚本.sh".to_string(),
            script_content: Some("printf '你好 🌟\\n'".to_string()),
            cleanup_paths: vec!["/tmp/脚本.sh".to_string()],
            cols: 120,
            rows: 40,
        });
        let encoded = encode_terminal_client_payload(&payload).expect("payload should encode");
        let decoded = decode_terminal_client_payload(&encoded).expect("payload should decode");
        assert_eq!(decoded, payload);
    }

    #[test]
    fn interactive_payload_roundtrips_multilingual_input() {
        let payload =
            WslLinkTerminalClientPayload::InteractiveInput(WslLinkTerminalInteractiveInput {
                session_id: "main-terminal".to_string(),
                data: "printf '你好 🌟'\n".to_string(),
            });
        let encoded = encode_terminal_client_payload(&payload).expect("payload should encode");
        let decoded = decode_terminal_client_payload(&encoded).expect("payload should decode");
        assert_eq!(decoded, payload);
    }

    #[test]
    fn run_input_payload_roundtrips_multilingual_input() {
        let payload = WslLinkTerminalClientPayload::RunInput(WslLinkTerminalRunInput {
            run_id: "run-交互-1".to_string(),
            data: "你好 🌟\n".to_string(),
        });
        let encoded = encode_terminal_client_payload(&payload).expect("payload should encode");
        let decoded = decode_terminal_client_payload(&encoded).expect("payload should decode");
        assert_eq!(decoded, payload);
    }

    #[test]
    fn utf8_decoder_keeps_split_multibyte_character() {
        let mut decoder = WslLinkUtf8ChunkDecoder::default();
        let bytes = "你".as_bytes();
        let mut output = String::new();
        decoder.decode_into(&bytes[..1], &mut output, false);
        decoder.decode_into(&bytes[1..], &mut output, true);
        assert_eq!(output, "你");
    }

    // 改动 5: 防止 *_KIND 常量与 enum variant 的 serde rename 漂移。
    // serde 的 rename 不能引用 const,只能用字符串字面量,这是唯一可靠抓漂移的办法。
    #[test]
    fn client_payload_serde_tag_matches_kind_constant() {
        let payload = WslLinkTerminalClientPayload::RunScript(WslLinkTerminalRunScriptRequest {
            run_id: "run-1".into(),
            working_directory: "/tmp".into(),
            execution_path: "/tmp/x.sh".into(),
            script_content: None,
            cleanup_paths: vec![],
            cols: 80,
            rows: 24,
        });
        let value = serde_json::to_value(&payload).expect("serializes");
        assert_eq!(value["type"], TERMINAL_RUN_SCRIPT_KIND);
    }

    #[test]
    fn server_payload_serde_tag_matches_kind_constant() {
        let payload = WslLinkTerminalServerPayload::RunStarted(WslLinkTerminalRunStarted {
            run_id: "run-1".into(),
            pid: 1234,
            started_at_unix_ms: 1_700_000_000_000,
        });
        let value = serde_json::to_value(&payload).expect("serializes");
        assert_eq!(value["type"], TERMINAL_RUN_STARTED_KIND);
    }

    // 改动 3: signal mode 常量被实际使用 + 校验拒绝未知值。
    #[test]
    fn signal_process_validate_accepts_known_modes_and_rejects_others() {
        let graceful = WslLinkTerminalSignalProcess {
            pid: 1,
            mode: SIGNAL_MODE_GRACEFUL.to_string(),
        };
        assert!(graceful.validate().is_ok());

        let kill = WslLinkTerminalSignalProcess {
            pid: 1,
            mode: SIGNAL_MODE_KILL.to_string(),
        };
        assert!(kill.validate().is_ok());

        let unknown = WslLinkTerminalSignalProcess {
            pid: 1,
            mode: "SIGTERM".to_string(),
        };
        assert!(unknown.validate().is_err());

        let zero_pid = WslLinkTerminalSignalProcess {
            pid: 0,
            mode: SIGNAL_MODE_GRACEFUL.to_string(),
        };
        assert!(zero_pid.validate().is_err());
    }

    // 改动 1 续: helper 错误消息与重构前字面等价。
    #[test]
    fn ensure_field_non_empty_error_message_is_backward_compatible() {
        let request = WslLinkTerminalRunInput {
            run_id: "   ".to_string(),
            data: "noop".to_string(),
        };
        let err = request.validate().expect_err("blank run_id should error");
        assert_eq!(
            err.to_string(),
            "WSL Link terminal payload 无效：run_id 不能为空。"
        );
    }
}