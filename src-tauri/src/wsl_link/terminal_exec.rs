use std::{env, path::PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const TERMINAL_RUN_SCRIPT_KIND: &str = "terminal.runScript.v1";
pub const TERMINAL_RUN_STARTED_KIND: &str = "terminal.runStarted.v1";
pub const TERMINAL_RUN_CHUNK_KIND: &str = "terminal.runChunk.v1";
pub const TERMINAL_RUN_COMPLETED_KIND: &str = "terminal.runCompleted.v1";
pub const TERMINAL_RUN_ERROR_KIND: &str = "terminal.runError.v1";

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
        if self.run_id.trim().is_empty() {
            return Err(WslLinkTerminalExecError::Payload(
                "run_id 不能为空。".to_string(),
            ));
        }
        if self.working_directory.trim().is_empty() {
            return Err(WslLinkTerminalExecError::Payload(
                "working_directory 不能为空。".to_string(),
            ));
        }
        if self.execution_path.trim().is_empty() {
            return Err(WslLinkTerminalExecError::Payload(
                "execution_path 不能为空。".to_string(),
            ));
        }
        if self.cols < 2 || self.rows < 1 {
            return Err(WslLinkTerminalExecError::Payload(
                "终端尺寸必须有效。".to_string(),
            ));
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
#[serde(tag = "type", content = "payload")]
pub enum WslLinkTerminalClientPayload {
    #[serde(rename = "terminal.runScript.v1")]
    RunScript(WslLinkTerminalRunScriptRequest),
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
                        if let Ok(valid_prefix) = std::str::from_utf8(&self.pending[..valid_up_to])
                        {
                            output.push_str(valid_prefix);
                        }
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
    fn utf8_decoder_keeps_split_multibyte_character() {
        let mut decoder = WslLinkUtf8ChunkDecoder::default();
        let bytes = "你".as_bytes();
        let mut output = String::new();

        decoder.decode_into(&bytes[..1], &mut output, false);
        decoder.decode_into(&bytes[1..], &mut output, true);

        assert_eq!(output, "你");
    }
}
