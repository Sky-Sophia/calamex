use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderMessage {
    pub role: String,
    pub content: String,
}

impl AiProviderMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new("user", content)
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::new("system", content)
    }

    pub fn is_empty(&self) -> bool {
        self.content.trim().is_empty()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderChatRequest {
    pub messages: Vec<AiProviderMessage>,
    #[serde(default)]
    pub tools: Vec<AiProviderToolSpec>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub force_tool_choice_none: bool,
}

impl AiProviderChatRequest {
    pub fn new(messages: Vec<AiProviderMessage>) -> Self {
        Self {
            messages,
            tools: Vec::new(),
            force_tool_choice_none: false,
        }
    }

    pub fn with_tools(mut self, tools: Vec<AiProviderToolSpec>) -> Self {
        self.tools = tools;
        self.force_tool_choice_none = false;
        self
    }

    pub fn with_tool_choice_none(mut self) -> Self {
        self.tools.clear();
        self.force_tool_choice_none = true;
        self
    }

    pub fn is_empty(&self) -> bool {
        self.messages.iter().all(AiProviderMessage::is_empty)
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderInputTokenDetails {
    pub no_cache_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
}

impl AiProviderInputTokenDetails {
    pub fn new(no_cache_tokens: u64, cache_read_tokens: u64, cache_write_tokens: u64) -> Self {
        Self {
            no_cache_tokens,
            cache_read_tokens,
            cache_write_tokens,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderOutputTokenDetails {
    pub text_tokens: u64,
    pub reasoning_tokens: u64,
}

impl AiProviderOutputTokenDetails {
    pub fn new(text_tokens: u64, reasoning_tokens: u64) -> Self {
        Self {
            text_tokens,
            reasoning_tokens,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderUsage {
    pub input_tokens: u64,
    pub input_token_details: AiProviderInputTokenDetails,
    pub output_tokens: u64,
    pub output_token_details: AiProviderOutputTokenDetails,
    pub total_tokens: u64,
    pub cached_input_tokens: u64,
    pub reasoning_tokens: u64,
    pub raw: Value,
}

impl AiProviderUsage {
    pub fn from_openai_usage(raw: Value) -> Self {
        let input_tokens = value_u64(&raw, &["prompt_tokens", "input_tokens"]);
        let output_tokens = value_u64(&raw, &["completion_tokens", "output_tokens"]);
        let total_tokens = value_u64(&raw, &["total_tokens"]).unwrap_or_else(|| {
            input_tokens.unwrap_or_default() + output_tokens.unwrap_or_default()
        });

        let prompt_details = raw.get("prompt_tokens_details");
        let completion_details = raw.get("completion_tokens_details");
        let cache_read_tokens = value_u64(&raw, &["prompt_cache_hit_tokens"])
            .or_else(|| nested_value_u64(prompt_details, &["cached_tokens", "cache_read_tokens"]))
            .unwrap_or_default();
        let no_cache_tokens = value_u64(&raw, &["prompt_cache_miss_tokens"])
            .or_else(|| nested_value_u64(prompt_details, &["no_cache_tokens"]))
            .unwrap_or_else(|| {
                input_tokens
                    .unwrap_or_default()
                    .saturating_sub(cache_read_tokens)
            });
        let cache_write_tokens =
            nested_value_u64(prompt_details, &["cache_write_tokens"]).unwrap_or_default();
        let reasoning_tokens =
            nested_value_u64(completion_details, &["reasoning_tokens", "reasoningTokens"])
                .or_else(|| value_u64(&raw, &["reasoning_tokens", "reasoningTokens"]))
                .unwrap_or_default();
        let text_tokens = output_tokens
            .unwrap_or_default()
            .saturating_sub(reasoning_tokens);

        Self {
            input_tokens: input_tokens.unwrap_or_default(),
            input_token_details: AiProviderInputTokenDetails::new(
                no_cache_tokens,
                cache_read_tokens,
                cache_write_tokens,
            ),
            output_tokens: output_tokens.unwrap_or_default(),
            output_token_details: AiProviderOutputTokenDetails::new(text_tokens, reasoning_tokens),
            total_tokens,
            cached_input_tokens: cache_read_tokens,
            reasoning_tokens,
            raw,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderTokenEstimate {
    pub input_tokens: u64,
    pub tokenizer: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderResponse {
    pub content: String,
    pub model: String,
    pub tool_calls: Vec<AiProviderToolCall>,
    pub usage: Option<AiProviderUsage>,
    pub prompt_estimate: Option<AiProviderTokenEstimate>,
}

impl AiProviderResponse {
    pub fn with_usage(
        content: impl Into<String>,
        model: impl Into<String>,
        tool_calls: Vec<AiProviderToolCall>,
        usage: Option<AiProviderUsage>,
        prompt_estimate: Option<AiProviderTokenEstimate>,
    ) -> Self {
        Self {
            content: content.into(),
            model: model.into(),
            tool_calls,
            usage,
            prompt_estimate,
        }
    }
}

fn value_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let item = value.get(*key)?;
        item.as_u64().or_else(|| {
            let number = item.as_f64()?;
            (number.is_finite() && number >= 0.0).then_some(number as u64)
        })
    })
}

fn nested_value_u64(value: Option<&Value>, keys: &[&str]) -> Option<u64> {
    value.and_then(|item| value_u64(item, keys))
}

#[cfg(test)]
mod tests {
    use super::{AiProviderChatRequest, AiProviderMessage};

    #[test]
    fn chat_request_detects_empty_content() {
        let request = AiProviderChatRequest::new(vec![
            AiProviderMessage::system("   "),
            AiProviderMessage::user("\n"),
        ]);

        assert!(request.is_empty());
    }
}
