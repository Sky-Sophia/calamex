use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParsedNarratorResponse {
    should_show: bool,
    tone: String,
    text: String,
    #[serde(default)]
    related_files: Vec<String>,
    #[serde(default)]
    confidence: Option<String>,
}

pub async fn narrate_activity(
    payload: AiNarratorRequest,
) -> Result<AiNarratorResponsePayload, String> {
    let config = current_config()?;
    let narrator_config = &config.narrator;
    let model = narrator_config
        .selected_model
        .as_deref()
        .unwrap_or(DEFAULT_NARRATOR_MODEL);
    let base_url = resolve_model_endpoint_base_url(narrator_config)?;
    let api_key = get_api_key_for_model_endpoint(narrator_config, AiResolvedModelRole::Narrator)?;
    let request = AiProviderChatRequest::new(vec![
        conversation::build_identity_system_message(model),
        AiProviderMessage::system(build_narrator_system_prompt()),
        AiProviderMessage::user(build_narrator_user_prompt(&payload.facts)),
    ]);
    let response =
        connection::chat_with_litellm_fallback(base_url, &api_key, model, request).await?;
    let parsed = parse_narrator_response(&response.content)
        .unwrap_or_else(|| fallback_narrator_response_payload(&payload, &payload.facts));

    Ok(AiNarratorResponsePayload {
        run_id: payload.run_id,
        message_id: payload.message_id,
        turn_id: payload.turn_id,
        facts_hash: payload.facts_hash,
        sequence: payload.sequence,
        trigger: payload.facts.trigger,
        should_show: parsed.should_show,
        tone: parsed.tone,
        text: parsed.text,
        related_files: parsed.related_files,
        confidence: parsed.confidence,
        model: response.model,
    })
}

pub async fn narrate_activity_stream(
    app: AppHandle,
    payload: AiNarratorRequest,
) -> Result<AiNarratorStreamStart, String> {
    let config = current_config()?;
    let narrator_config = config.narrator.clone();
    let model = narrator_config
        .selected_model
        .as_deref()
        .unwrap_or(DEFAULT_NARRATOR_MODEL)
        .to_string();
    let stream_id = next_runtime_id("narrator-stream");

    stream_manager::register(&stream_id);

    let task_stream_id = stream_id.clone();
    let task_narrator_config = narrator_config.clone();
    let task_model = model.clone();
    let task_payload = payload.clone();

    tokio::spawn(async move {
        emit_narrator_stream_event(
            &app,
            AiNarratorStreamEventPayload {
                stream_id: task_stream_id.clone(),
                run_id: task_payload.run_id.clone(),
                message_id: task_payload.message_id.clone(),
                turn_id: task_payload.turn_id.clone(),
                facts_hash: task_payload.facts_hash.clone(),
                sequence: task_payload.sequence,
                trigger: task_payload.facts.trigger.clone(),
                kind: "start".to_string(),
                delta: None,
                message: None,
                should_show: None,
                tone: None,
                text: None,
                related_files: Vec::new(),
                confidence: None,
                model: Some(task_model.clone()),
            },
        );

        let result = async {
            let base_url = resolve_model_endpoint_base_url(&task_narrator_config)?.to_string();
            let api_key = get_api_key_for_model_endpoint(
                &task_narrator_config,
                AiResolvedModelRole::Narrator,
            )?;
            let request = AiProviderChatRequest::new(vec![
                conversation::build_identity_system_message(&task_model),
                AiProviderMessage::system(build_narrator_stream_system_prompt()),
                AiProviderMessage::user(build_narrator_user_prompt(&task_payload.facts)),
            ]);
            let mut full_text = String::new();

            connection::chat_stream_with_litellm_fallback(
                &base_url,
                &api_key,
                &task_model,
                request,
                |event| {
                    let openai_compatible::AiProviderStreamEvent::Delta { delta, .. } = event
                    else {
                        return Ok(());
                    };

                    if delta.is_empty() {
                        return Ok(());
                    }

                    full_text.push_str(&delta);

                    emit_narrator_stream_event(
                        &app,
                        AiNarratorStreamEventPayload {
                            stream_id: task_stream_id.clone(),
                            run_id: task_payload.run_id.clone(),
                            message_id: task_payload.message_id.clone(),
                            turn_id: task_payload.turn_id.clone(),
                            facts_hash: task_payload.facts_hash.clone(),
                            sequence: task_payload.sequence,
                            trigger: task_payload.facts.trigger.clone(),
                            kind: "delta".to_string(),
                            delta: Some(delta),
                            message: None,
                            should_show: None,
                            tone: None,
                            text: None,
                            related_files: Vec::new(),
                            confidence: None,
                            model: Some(task_model.clone()),
                        },
                    );

                    Ok(())
                },
                || stream_manager::is_cancelled(&task_stream_id),
            )
            .await
            .map(|()| full_text)
        }
        .await;

        match result {
            Ok(full_text) => {
                if stream_manager::is_cancelled(&task_stream_id) {
                    emit_narrator_stream_event(
                        &app,
                        AiNarratorStreamEventPayload {
                            stream_id: task_stream_id.clone(),
                            run_id: task_payload.run_id.clone(),
                            message_id: task_payload.message_id.clone(),
                            turn_id: task_payload.turn_id.clone(),
                            facts_hash: task_payload.facts_hash.clone(),
                            sequence: task_payload.sequence,
                            trigger: task_payload.facts.trigger.clone(),
                            kind: "cancelled".to_string(),
                            delta: None,
                            message: Some("AI 活动旁白已取消。".to_string()),
                            should_show: None,
                            tone: None,
                            text: None,
                            related_files: Vec::new(),
                            confidence: None,
                            model: Some(task_model.clone()),
                        },
                    );
                } else {
                    let finalized = finalize_streamed_narrator_response(&task_payload, &full_text);

                    emit_narrator_stream_event(
                        &app,
                        AiNarratorStreamEventPayload {
                            stream_id: task_stream_id.clone(),
                            run_id: task_payload.run_id.clone(),
                            message_id: task_payload.message_id.clone(),
                            turn_id: task_payload.turn_id.clone(),
                            facts_hash: task_payload.facts_hash.clone(),
                            sequence: task_payload.sequence,
                            trigger: task_payload.facts.trigger.clone(),
                            kind: "done".to_string(),
                            delta: None,
                            message: None,
                            should_show: Some(finalized.should_show),
                            tone: Some(finalized.tone),
                            text: Some(finalized.text),
                            related_files: finalized.related_files,
                            confidence: finalized.confidence,
                            model: Some(task_model.clone()),
                        },
                    );
                }
            }
            Err(error) => {
                let kind = if error.contains("AI_REQUEST_CANCELLED") {
                    "cancelled"
                } else {
                    "error"
                };

                emit_narrator_stream_event(
                    &app,
                    AiNarratorStreamEventPayload {
                        stream_id: task_stream_id.clone(),
                        run_id: task_payload.run_id.clone(),
                        message_id: task_payload.message_id.clone(),
                        turn_id: task_payload.turn_id.clone(),
                        facts_hash: task_payload.facts_hash.clone(),
                        sequence: task_payload.sequence,
                        trigger: task_payload.facts.trigger.clone(),
                        kind: kind.to_string(),
                        delta: None,
                        message: Some(error),
                        should_show: None,
                        tone: None,
                        text: None,
                        related_files: Vec::new(),
                        confidence: None,
                        model: Some(task_model.clone()),
                    },
                );
            }
        }

        stream_manager::finish(&task_stream_id);
    });

    Ok(AiNarratorStreamStart {
        stream_id,
        run_id: payload.run_id,
        message_id: payload.message_id,
        turn_id: payload.turn_id,
        facts_hash: payload.facts_hash,
        sequence: payload.sequence,
        trigger: payload.facts.trigger,
        model,
    })
}

fn build_narrator_system_prompt() -> String {
    [
        "你是 IDE 活动流里的 Narrator，只负责把压缩事实改写成一句自然的中文旁白。",
        "你不能编造未提供的步骤、文件、错误或结论。",
        "输出必须是 JSON 对象，不要输出 Markdown、代码块或额外解释。",
        "JSON schema: {\"shouldShow\":boolean,\"tone\":\"plan|progress|decision|repair|warning|summary\",\"text\":string,\"relatedFiles\":string[],\"confidence\":\"low|medium|high\"|null}",
        "当事实不足、内容重复或不值得展示时，shouldShow=false，text 置为空字符串。",
        "text 最长 48 个中文字符，口吻要像 IDE 正在播报当前动作，而不是写总结报告。",
    ]
    .join("\n")
}

fn build_narrator_stream_system_prompt() -> String {
    [
        "你是 IDE 活动流里的 Narrator，只输出一条正在生成中的中文旁白。",
        "只允许输出最终展示给用户的旁白正文，不要 JSON、不要 Markdown、不要项目符号、不要解释。",
        "旁白要粗粒度，只说阶段推进、关键发现和下一步，不复述每个工具名，不把工具日志改写成报告。",
        "触发点决定语气：run_started/plan_ready/plan_approved 用起手语气；context_checked/search_done/files_read/web_search_done 用推进语气；edit_done/git_commit_ready 用决策语气；verification_started 用验证起手；verification_failed/patch_failed/test_failed 用修复语气；final_summary/verification_done/git_done 用收束语气。",
        "优先使用“先……，再……”“已经……，接下来……”“这一步……，下一步……”这种 IDE 播报句式。",
        "最长 48 个中文字符，保持一句话。事实不足或不值得展示时返回空字符串。",
    ]
    .join("\n")
}

fn build_narrator_user_prompt(facts: &AiNarratorFactsPayload) -> String {
    let recent_actions = if facts.recent_actions.is_empty() {
        "无".to_string()
    } else {
        facts
            .recent_actions
            .iter()
            .take(8)
            .map(|item| format!("- {}", sanitize_fenced_text(item)))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let changed_files = if facts.changed_files.is_empty() {
        "无".to_string()
    } else {
        facts
            .changed_files
            .iter()
            .take(6)
            .map(|file| {
                let diff = match (file.additions, file.deletions) {
                    (Some(additions), Some(deletions)) => {
                        format!(" (+{} -{})", additions, deletions)
                    }
                    (Some(additions), None) => format!(" (+{})", additions),
                    (None, Some(deletions)) => format!(" (-{})", deletions),
                    (None, None) => String::new(),
                };
                format!("- {}{}", sanitize_fenced_text(&file.path), diff)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let read_files = if facts.read_files.is_empty() {
        "无".to_string()
    } else {
        facts
            .read_files
            .iter()
            .take(6)
            .map(|file| match file.range.as_deref() {
                Some(range) if !range.trim().is_empty() => {
                    format!(
                        "- {} ({})",
                        sanitize_fenced_text(&file.path),
                        sanitize_fenced_text(range)
                    )
                }
                _ => format!("- {}", sanitize_fenced_text(&file.path)),
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let previous_narrations = if facts.previous_narrations.is_empty() {
        "无".to_string()
    } else {
        facts
            .previous_narrations
            .iter()
            .take(4)
            .map(|item| format!("- {}", sanitize_fenced_text(item)))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let search_summary = facts
        .search_summary
        .as_ref()
        .map(|item| match item.result_count {
            Some(result_count) => format!(
                "{}（{} 条）",
                sanitize_fenced_text(&item.query),
                result_count
            ),
            None => sanitize_fenced_text(&item.query),
        })
        .unwrap_or_else(|| "无".to_string());

    format!(
        "用户目标：{}\n触发点：{}\n\n最近动作：\n{}\n\n变更文件：\n{}\n\n读取文件：\n{}\n\n搜索摘要：{}\n当前发现：{}\n下一步：{}\n错误摘要：{}\n\n历史旁白：\n{}",
        sanitize_fenced_text(&facts.user_goal),
        sanitize_fenced_text(&facts.trigger),
        recent_actions,
        changed_files,
        read_files,
        search_summary,
        sanitize_fenced_text(facts.current_finding.as_deref().unwrap_or("无")),
        sanitize_fenced_text(facts.next_action.as_deref().unwrap_or("无")),
        sanitize_fenced_text(facts.error_summary.as_deref().unwrap_or("无")),
        previous_narrations,
    )
}

fn parse_narrator_response(value: &str) -> Option<ParsedNarratorResponse> {
    let trimmed = value.trim();
    let json_slice = if trimmed.starts_with('{') {
        trimmed
    } else {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        trimmed.get(start..=end)?
    };

    serde_json::from_str::<ParsedNarratorResponse>(json_slice)
        .ok()
        .map(|parsed| ParsedNarratorResponse {
            should_show: parsed.should_show,
            tone: normalize_narrator_tone(&parsed.tone),
            text: normalize_narrator_text(&parsed.text),
            related_files: parsed
                .related_files
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .take(6)
                .collect(),
            confidence: parsed
                .confidence
                .map(|item| normalize_narrator_confidence(&item)),
        })
}

fn fallback_narrator_response_payload(
    payload: &AiNarratorRequest,
    facts: &AiNarratorFactsPayload,
) -> ParsedNarratorResponse {
    let text = facts
        .current_finding
        .as_deref()
        .or(facts.next_action.as_deref())
        .or(facts.error_summary.as_deref())
        .map(normalize_narrator_text)
        .unwrap_or_default();
    let should_show = !text.is_empty();

    ParsedNarratorResponse {
        should_show,
        tone: infer_fallback_narrator_tone(&payload.facts.trigger, facts),
        text,
        related_files: collect_narrator_related_files(facts),
        confidence: Some(infer_narrator_confidence(facts, should_show)),
    }
}

fn finalize_streamed_narrator_response(
    payload: &AiNarratorRequest,
    raw_text: &str,
) -> ParsedNarratorResponse {
    let normalized = normalize_narrator_text(raw_text);

    if normalized.is_empty() {
        return fallback_narrator_response_payload(payload, &payload.facts);
    }

    ParsedNarratorResponse {
        should_show: true,
        tone: infer_fallback_narrator_tone(&payload.facts.trigger, &payload.facts),
        text: normalized,
        related_files: collect_narrator_related_files(&payload.facts),
        confidence: Some(infer_narrator_confidence(&payload.facts, true)),
    }
}

fn collect_narrator_related_files(facts: &AiNarratorFactsPayload) -> Vec<String> {
    facts
        .changed_files
        .iter()
        .map(|item| item.path.clone())
        .chain(facts.read_files.iter().map(|item| item.path.clone()))
        .take(6)
        .collect()
}

fn infer_narrator_confidence(facts: &AiNarratorFactsPayload, should_show: bool) -> String {
    if !should_show {
        return "low".to_string();
    }

    if !facts.changed_files.is_empty()
        || !facts.read_files.is_empty()
        || facts.search_summary.is_some()
        || facts.current_finding.is_some()
    {
        return "medium".to_string();
    }

    "low".to_string()
}

fn normalize_narrator_text(value: &str) -> String {
    value
        .trim()
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(48)
        .collect()
}

fn normalize_narrator_tone(value: &str) -> String {
    match value.trim() {
        "plan" | "progress" | "decision" | "repair" | "warning" | "summary" => {
            value.trim().to_string()
        }
        _ => "progress".to_string(),
    }
}

fn normalize_narrator_confidence(value: &str) -> String {
    match value.trim() {
        "low" | "medium" | "high" => value.trim().to_string(),
        _ => "low".to_string(),
    }
}

fn infer_fallback_narrator_tone(trigger: &str, facts: &AiNarratorFactsPayload) -> String {
    match trigger {
        "run_started" | "plan_ready" | "plan_approved" => "plan".to_string(),
        "patch_failed" | "verification_failed" | "test_failed" => "repair".to_string(),
        "verification_done" | "git_done" | "final_summary" => "summary".to_string(),
        "edit_done" | "edit_batch_done" | "git_commit_ready" => "decision".to_string(),
        "git_diff_ready" => {
            if facts.error_summary.is_some() {
                "warning".to_string()
            } else {
                "progress".to_string()
            }
        }
        "git_checked" => {
            if facts.error_summary.is_some() || facts.current_finding.is_some() {
                "warning".to_string()
            } else {
                "progress".to_string()
            }
        }
        "context_checked" | "search_done" | "files_read" | "web_search_done" => {
            "progress".to_string()
        }
        "time_checked" | "verification_started" => "progress".to_string(),
        _ => "progress".to_string(),
    }
}

fn emit_narrator_stream_event(app: &AppHandle, payload: AiNarratorStreamEventPayload) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("ai:narrator-stream", payload);
    }
}
