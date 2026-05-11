import { describe, expect, it } from 'vitest';

import { classifyRuntimeToolKind } from '@/constants/ai-runtime-tools';

describe('ai-runtime-tools', () => {
  it('把 Tavily MCP 官方工具识别为联网工具', () => {
    expect(classifyRuntimeToolKind('tavily-search')).toBe('network');
    expect(classifyRuntimeToolKind('tavily-extract')).toBe('network');
    expect(classifyRuntimeToolKind('tavily_map')).toBe('network');
    expect(classifyRuntimeToolKind('tavily-mcp_tavily_search')).toBe('network');
  });

  it('把 Mastra 官方浏览器工具识别为浏览器工具', () => {
    expect(classifyRuntimeToolKind('browser_goto')).toBe('browser');
    expect(classifyRuntimeToolKind('browser_snapshot')).toBe('browser');
  });
});
