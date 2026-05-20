// 本文件由 scripts/gen-tools.mjs 生成，请勿手改。
#![allow(dead_code)]

#[derive(Debug, Clone, Copy)]
pub struct AiRuntimeToolManifestEntry {
    pub id: &'static str,
    pub title: &'static str,
    pub layer: &'static str,
    pub capability: &'static str,
    pub approval: &'static str,
}

pub const AI_TOOLS_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const AI_RUNTIME_TOOLS_MANIFEST: &[AiRuntimeToolManifestEntry] = &[
    AiRuntimeToolManifestEntry {
        id: "mcp_list_tools",
        title: "列出 MCP 工具",
        layer: "sidecar",
        capability: "ai-mcp",
        approval: "none",
    },
    AiRuntimeToolManifestEntry {
        id: "mcp_call_tool",
        title: "调用 MCP 工具",
        layer: "sidecar",
        capability: "ai-mcp",
        approval: "required",
    },
    AiRuntimeToolManifestEntry {
        id: "web_search",
        title: "联网搜索",
        layer: "rust",
        capability: "ai-mcp",
        approval: "required",
    },
    AiRuntimeToolManifestEntry {
        id: "web_fetch",
        title: "读取网页",
        layer: "rust",
        capability: "ai-mcp",
        approval: "required",
    }
];
