use std::path::PathBuf;

use thiserror::Error;

pub const AGENT_NOISE_CONFIG_ENV: &str = "CALAMEX_WSL_LINK_AGENT_NOISE_CONFIG";
pub const DEFAULT_AGENT_NOISE_CONFIG_PATH: &str = "/etc/calamex/wsl-link/agent-noise.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslLinkAgentStartupConfig {
    pub noise_config_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WslLinkAgentStartupAction {
    Run(WslLinkAgentStartupConfig),
    PrintHelp,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WslLinkAgentStartupError {
    #[error("WSL Link agent 参数 {0} 缺少值。")]
    MissingValue(&'static str),
    #[error("WSL Link agent 不支持参数：{0}")]
    UnknownArgument(String),
    #[error("WSL Link agent Noise 配置路径不能为空。")]
    EmptyNoiseConfigPath,
}

pub fn resolve_agent_startup_action<I, S>(
    args: I,
    env_noise_config_path: Option<String>,
) -> Result<WslLinkAgentStartupAction, WslLinkAgentStartupError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut noise_config_path = normalize_path_value(env_noise_config_path)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_AGENT_NOISE_CONFIG_PATH));

    let mut args = args.into_iter().map(Into::into);
    let _program = args.next();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(WslLinkAgentStartupAction::PrintHelp),
            "--noise-config" => {
                let value = args
                    .next()
                    .ok_or(WslLinkAgentStartupError::MissingValue("--noise-config"))?;
                // 改动 1: 防止 `--noise-config --help` 把另一个 flag 当 path 吞掉
                if value.starts_with("--") || value == "-h" {
                    return Err(WslLinkAgentStartupError::MissingValue("--noise-config"));
                }
                noise_config_path = normalize_required_path_value(&value)?;
            }
            _ => return Err(WslLinkAgentStartupError::UnknownArgument(arg)),
        }
    }

    Ok(WslLinkAgentStartupAction::Run(WslLinkAgentStartupConfig {
        noise_config_path,
    }))
}

// 改动 3: raw string,消除续行反斜杠
pub fn agent_help_text() -> &'static str {
    r#"用法：wsl-link-agent [--noise-config <path>]

    --noise-config <path>  指定 Noise agent 配置 JSON，默认读取 /etc/calamex/wsl-link/agent-noise.json。
    -h, --help             显示帮助。"#
}

// 改动 2: 直接接 &str,不再包 Option
fn normalize_required_path_value(value: &str) -> Result<PathBuf, WslLinkAgentStartupError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(WslLinkAgentStartupError::EmptyNoiseConfigPath);
    }
    Ok(PathBuf::from(trimmed))
}

fn normalize_path_value(value: Option<String>) -> Option<PathBuf> {
    let trimmed = value?;
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        resolve_agent_startup_action, WslLinkAgentStartupAction, WslLinkAgentStartupConfig,
        WslLinkAgentStartupError, DEFAULT_AGENT_NOISE_CONFIG_PATH,
    };

    #[test]
    fn startup_uses_default_noise_config_path() {
        let action =
            resolve_agent_startup_action(["wsl-link-agent"], None).expect("args should parse");
        assert_eq!(
            action,
            WslLinkAgentStartupAction::Run(WslLinkAgentStartupConfig {
                noise_config_path: PathBuf::from(DEFAULT_AGENT_NOISE_CONFIG_PATH),
            })
        );
    }

    #[test]
    fn startup_uses_env_noise_config_path() {
        let action = resolve_agent_startup_action(
            ["wsl-link-agent"],
            Some("/home/me/agent-noise.json".to_string()),
        )
        .expect("args should parse");
        assert_eq!(
            action,
            WslLinkAgentStartupAction::Run(WslLinkAgentStartupConfig {
                noise_config_path: PathBuf::from("/home/me/agent-noise.json"),
            })
        );
    }

    #[test]
    fn startup_arg_overrides_env_noise_config_path() {
        let action = resolve_agent_startup_action(
            ["wsl-link-agent", "--noise-config", "/tmp/agent-noise.json"],
            Some("/home/me/agent-noise.json".to_string()),
        )
        .expect("args should parse");
        assert_eq!(
            action,
            WslLinkAgentStartupAction::Run(WslLinkAgentStartupConfig {
                noise_config_path: PathBuf::from("/tmp/agent-noise.json"),
            })
        );
    }

    #[test]
    fn startup_rejects_missing_noise_config_value() {
        let result = resolve_agent_startup_action(["wsl-link-agent", "--noise-config"], None);
        assert_eq!(
            result,
            Err(WslLinkAgentStartupError::MissingValue("--noise-config"))
        );
    }

    #[test]
    fn startup_rejects_empty_noise_config_value() {
        let result = resolve_agent_startup_action(["wsl-link-agent", "--noise-config", "  "], None);
        assert_eq!(result, Err(WslLinkAgentStartupError::EmptyNoiseConfigPath));
    }

    #[test]
    fn startup_supports_help_action() {
        let action =
            resolve_agent_startup_action(["wsl-link-agent", "--help"], None).expect("help works");
        assert_eq!(action, WslLinkAgentStartupAction::PrintHelp);
    }

    // 改动 4: 以下三个测试补齐之前没覆盖的分支

    #[test]
    fn startup_rejects_unknown_argument() {
        let result = resolve_agent_startup_action(["wsl-link-agent", "--bogus"], None);
        assert_eq!(
            result,
            Err(WslLinkAgentStartupError::UnknownArgument(
                "--bogus".to_string()
            ))
        );
    }

    #[test]
    fn startup_falls_back_to_default_when_env_is_blank() {
        // 空字符串 / 仅空白 应当被当作未设置
        let action = resolve_agent_startup_action(["wsl-link-agent"], Some("   ".to_string()))
            .expect("args should parse");
        assert_eq!(
            action,
            WslLinkAgentStartupAction::Run(WslLinkAgentStartupConfig {
                noise_config_path: PathBuf::from(DEFAULT_AGENT_NOISE_CONFIG_PATH),
            })
        );
    }

    #[test]
    fn startup_rejects_flag_consumed_as_noise_config_value() {
        // `--noise-config --help` 不应让 --help 成为 path
        let result = resolve_agent_startup_action(
            ["wsl-link-agent", "--noise-config", "--help"],
            None,
        );
        assert_eq!(
            result,
            Err(WslLinkAgentStartupError::MissingValue("--noise-config"))
        );
    }
}