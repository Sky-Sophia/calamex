pub(crate) mod agent;
pub(crate) mod edit;
pub(crate) mod gateway;
mod storage;
pub(crate) mod tools;
pub mod tools_generated;

// 命令由 `tauri_bindings.rs` 以定义子模块限定路径登记（如 `ai::agent::ai_agent_classify_task`），
// 以便 tauri-specta 解析配套宏；故此处不再重新导出扁平命令名（旧 `generate_handler!` 时代遗留）。
