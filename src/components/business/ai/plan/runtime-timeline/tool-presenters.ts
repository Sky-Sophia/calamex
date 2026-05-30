import {
  APPLY_FILE_EDIT_TOOL_NAMES,
  COMMAND_TOOL_NAMES,
  CURRENT_FILE_TOOL_NAMES,
  DIRECTORY_READ_TOOL_NAMES,
  READ_FILE_TOOL_NAMES,
  SYMBOL_SEARCH_TOOL_NAMES,
  TEXT_SEARCH_TOOL_NAMES,
  WRITE_FILE_TOOL_NAMES,
} from './constants';
import {
  extractFileNameFromPath,
  previewHasResultItems,
  resolvePreviewCommand,
  resolvePreviewPath,
  resolvePreviewQuery,
} from './preview';
import {
  extractShellcheckDiagnosticCodes,
  formatShellcheckIssueAction,
  hasShellcheckPassSummary,
  hasShellcheckUnavailableSummary,
} from './shellcheck';
import { isMcpListToolsName } from './tool-icons';
import {
  isWebSearchToolName,
  resolveWebSearchQuery,
  resolveWebSearchSources,
} from './web-search';
import type { IToolActionDescriptor, TToolLifecycleEvent } from './types';

export const describeToolAction = (
  event: TToolLifecycleEvent,
  toolName: string,
  fallbackResourceLabel?: string,
): IToolActionDescriptor => {
  const resourceLabel =
    fallbackResourceLabel ??
    resolvePreviewPath(
      event.type === 'agent.tool.started' ? event.inputPreview : event.resultPreview,
    ) ??
    undefined;

  if (toolName === 'shellcheck') {
    if (event.type !== 'agent.tool.completed') {
      return {
        action: '语法校验',
        suppressMeta: true,
      };
    }

    if (hasShellcheckPassSummary(event.resultPreview)) {
      return {
        action: '语法校验已通过',
        suppressMeta: true,
      };
    }

    const diagnosticCodes = extractShellcheckDiagnosticCodes(event.resultPreview);

    if (diagnosticCodes.length > 0) {
      return {
        action: formatShellcheckIssueAction(diagnosticCodes),
        suppressMeta: true,
      };
    }

    if (hasShellcheckUnavailableSummary(event.resultPreview) || !event.ok) {
      return {
        action: '语法校验未完成',
        suppressMeta: true,
      };
    }

    return {
      action: '语法校验已完成',
      suppressMeta: true,
    };
  }

  if (isMcpListToolsName(toolName)) {
    return {
      action:
        event.type === 'agent.tool.started'
          ? '正在查找MCP工具集'
          : event.ok
            ? '成功获取MCP工具集'
            : '查找MCP工具集失败',
      suppressMeta: true,
    };
  }

  if (CURRENT_FILE_TOOL_NAMES.has(toolName)) {
    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: '当前文件读取失败',
        suppressMeta: true,
      };
    }

    return {
      action: event.type === 'agent.tool.started' ? '正在读取当前文件' : '当前文件读取完成',
      suppressMeta: true,
    };
  }

  if (DIRECTORY_READ_TOOL_NAMES.has(toolName)) {
    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: '工作区目录读取失败',
        suppressMeta: true,
      };
    }

    return {
      action: event.type === 'agent.tool.started' ? '正在读取工作区目录' : '工作区目录读取完成',
      suppressMeta: true,
    };
  }

  if (TEXT_SEARCH_TOOL_NAMES.has(toolName)) {
    const query =
      fallbackResourceLabel ??
      (event.type === 'agent.tool.started' ? resolvePreviewQuery(event.inputPreview) : null) ??
      '搜索词';

    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: `未读取到 ${query}`,
        resourceLabel: query,
        suppressMeta: true,
      };
    }

    return {
      action:
        event.type === 'agent.tool.started'
          ? `正在搜索 ${query}`
          : previewHasResultItems(event.resultPreview)
            ? `成功读取到 ${query}`
            : `未读取到 ${query}`,
      resourceLabel: query,
      suppressMeta: true,
    };
  }

  if (SYMBOL_SEARCH_TOOL_NAMES.has(toolName)) {
    const query =
      fallbackResourceLabel ??
      (event.type === 'agent.tool.started' ? resolvePreviewQuery(event.inputPreview) : null) ??
      '搜索词';

    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: '当前文件读取失败',
        resourceLabel: query,
        suppressMeta: true,
      };
    }

    return {
      action:
        event.type === 'agent.tool.started'
          ? `正在结构化搜索 ${query}`
          : previewHasResultItems(event.resultPreview)
            ? `成功搜索到 ${query}`
            : `未搜索到 ${query}`,
      resourceLabel: query,
      suppressMeta: true,
    };
  }

  if (APPLY_FILE_EDIT_TOOL_NAMES.has(toolName)) {
    const fileName =
      fallbackResourceLabel ??
      (event.type === 'agent.tool.started' ? extractFileNameFromPath(event.inputPreview) : null) ??
      '文件';

    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: `编辑失败 ${fileName}`,
        resourceLabel: fileName,
        suppressMeta: true,
      };
    }

    return {
      action: event.type === 'agent.tool.started' ? `正在编辑 ${fileName}` : `编辑完成 ${fileName}`,
      resourceLabel: fileName,
      suppressMeta: true,
    };
  }

  if (READ_FILE_TOOL_NAMES.has(toolName) && resourceLabel) {
    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: `读取失败 ${resourceLabel}`,
        resourceLabel,
        suppressMeta: true,
      };
    }

    return {
      action:
        event.type === 'agent.tool.started'
          ? `正在读取 ${resourceLabel}`
          : `读取完成 ${resourceLabel}`,
      resourceLabel,
      suppressMeta: true,
    };
  }

  if (WRITE_FILE_TOOL_NAMES.has(toolName) && resourceLabel) {
    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: `编辑失败 ${resourceLabel}`,
        resourceLabel,
        suppressMeta: true,
      };
    }

    return {
      action:
        event.type === 'agent.tool.started'
          ? `正在编辑 ${resourceLabel}`
          : `编辑完成 ${resourceLabel}`,
      resourceLabel,
      suppressMeta: true,
    };
  }

  if (COMMAND_TOOL_NAMES.has(toolName)) {
    const command =
      fallbackResourceLabel ??
      (event.type === 'agent.tool.started' ? resolvePreviewCommand(event.inputPreview) : null) ??
      '命令';

    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: `执行失败 ${command}`,
        resourceLabel: command,
        suppressMeta: true,
      };
    }

    return {
      action: event.type === 'agent.tool.started' ? `正在执行 ${command}` : `执行完成 ${command}`,
      resourceLabel: command,
      suppressMeta: true,
    };
  }

  if (toolName === 'get_current_time') {
    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: '当前时间读取失败',
        suppressMeta: true,
      };
    }

    return {
      action: event.type === 'agent.tool.started' ? '正在读取当前时间' : '当前时间读取完成',
      suppressMeta: true,
    };
  }

  if (isWebSearchToolName(toolName)) {
    const query =
      resolveWebSearchQuery(event.type === 'agent.tool.started' ? event.inputPreview : undefined) ??
      fallbackResourceLabel ??
      undefined;
    const webSearchSources = resolveWebSearchSources(
      event.type === 'agent.tool.completed' ? event.resultPreview : event.inputPreview,
    );

    if (event.type === 'agent.tool.completed' && !event.ok) {
      return {
        action: 'Search Failed',
        resourceLabel: query,
        suppressMeta: true,
        webSearchSources,
      };
    }

    return {
      action:
        event.type === 'agent.tool.started'
          ? `Search for ${query ?? 'web results'}`
          : 'Complete Search',
      resourceLabel: query,
      suppressMeta: true,
      webSearchSources,
    };
  }

  return {
    action: event.type === 'agent.tool.started' ? `开始调用 ${toolName}` : `完成调用 ${toolName}`,
    resourceLabel,
  };
};
