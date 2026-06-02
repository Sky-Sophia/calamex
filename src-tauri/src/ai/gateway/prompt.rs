//! 网关侧的提示词 / 上下文拼装。
//!
//! 从 conversation.rs 收拢而来，集中所有"发往模型前"的文本成形逻辑。
//! 脱敏（redact_text）仍由 conversation 在调用点执行，本模块只负责拼字符串。

use super::*;

pub(super) fn build_inline_prompt(payload: &AiInlineCompletionRequest) -> String {
    format!(
        "只返回需要插入到光标处的代码，不要解释。\n语言：{}\n文件：{}\n前文：\n{}\n后文：\n{}",
        payload.language,
        payload.file_path,
        sanitize_fenced_text(&payload.prefix),
        sanitize_fenced_text(&payload.suffix)
    )
}

pub(super) fn build_code_action_prompt(payload: &AiCodeActionRequest) -> String {
    let file_path = payload.file_path.as_deref().unwrap_or("未保存文件");

    let diagnostics = if payload.diagnostics.is_empty() {
        "无".to_string()
    } else {
        payload.diagnostics.join("\n")
    };

    format!(
        "你是 IDE AI。请执行代码动作：{}。\n规则：不要直接声称已修改文件；如需修改，只描述建议并等待 patch 预览确认。\n文件：{}\n语言：{}\n诊断：\n{}\n选区：\n```{}\n{}\n```",
        payload.kind,
        file_path,
        payload.language,
        sanitize_fenced_text(&diagnostics),
        payload.language,
        sanitize_fenced_text(&payload.selection)
    )
}

pub(super) fn clip_title_source(value: &str) -> String {
    value.trim().chars().take(MAX_TITLE_SOURCE_CHARS).collect()
}

pub(super) fn build_conversation_title_prompt(
    user_message: &str,
    assistant_message: &str,
) -> String {
    format!(
        "请只依据下面第一轮问答生成中文会话标题。\n规则：\n- 只输出标题本身，不要解释、引号或标点\n- 标题必须为 5 到 10 个中文字符\n- 不要使用后续对话，因为后续对话未提供\n\n用户第一句：\n```text\n{}\n```\n\nAI 第一句：\n```text\n{}\n```",
        sanitize_fenced_text(user_message),
        sanitize_fenced_text(assistant_message)
    )
}

pub(super) fn build_identity_system_message(model: &str) -> AiProviderMessage {
    AiProviderMessage::system(build_identity_system_prompt(model))
}

pub(super) fn build_identity_system_prompt(model: &str) -> String {
    let trimmed_model = match model.trim() {
        "" => "未指定",
        value => value,
    };
    let provider_label = infer_model_provider_label(trimmed_model);

    format!(
        "身份：你是小建C桌面应用中的 AI 编程助手。当前模型：{trimmed_model}，平台：{provider_label}。用户询问身份时按当前真实模型回答，不冒充其他模型或厂商。"
    )
}

fn infer_model_provider_label(model: &str) -> &'static str {
    let normalized = model.trim().to_ascii_lowercase();

    if normalized.starts_with("deepseek/") || normalized.contains("deepseek") {
        return "DeepSeek";
    }

    if is_anthropic_model(model) {
        return "Anthropic";
    }

    if normalized.starts_with("openai/") || normalized.starts_with("gpt-") {
        return "OpenAI";
    }

    if normalized.starts_with("google/") || normalized.contains("gemini") {
        return "Google";
    }

    if normalized.starts_with("qwen/") || normalized.contains("qwen") {
        return "通义千问";
    }

    "当前配置的 AI 服务平台"
}

fn is_anthropic_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();

    normalized.starts_with("anthropic/") || normalized.contains("claude")
}

pub(super) fn build_context_block(references: &[AiContextReferencePayload]) -> String {
    if references.is_empty() {
        return String::new();
    }

    let mut block = String::new();

    for reference in references.iter().take(MAX_CONTEXT_REFERENCES) {
        let range = reference
            .range
            .as_ref()
            .map(|item| format!("{}-{}", item.start_line, item.end_line))
            .unwrap_or_else(|| "全文摘要".to_string());

        let path = reference.path.as_deref().unwrap_or("未保存");

        let preview: String = reference
            .content_preview
            .chars()
            .take(MAX_REFERENCE_PREVIEW_CHARS)
            .collect();

        let preview = sanitize_fenced_text(&preview);

        let redacted_label = if reference.redacted {
            "，已脱敏"
        } else {
            ""
        };

        block.push_str(&format!(
            "\n[{}] {} ({path}, {range}{redacted_label})\n```text\n{preview}\n```\n",
            reference.kind, reference.label
        ));

        if block.chars().count() >= MAX_CONTEXT_BLOCK_CHARS {
            let clipped: String = block.chars().take(MAX_CONTEXT_BLOCK_CHARS).collect();
            block = format!("{clipped}\n[上下文已按预算截断]\n");
            break;
        }
    }

    block
}
