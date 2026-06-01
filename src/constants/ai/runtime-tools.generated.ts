/* eslint-disable */
// 本文件由 scripts/gen-tools.mjs 生成，请勿手改。

export type TAiRuntimeToolKind =
  | 'search'
  | 'read'
  | 'write'
  | 'git'
  | 'browser'
  | 'terminal'
  | 'task'
  | 'network'
  | 'diagram'
  | 'symbol'
  | 'python'
  | 'java'
  | 'memory'
  | 'thinking'
  | 'system';

interface IToolKindMatcher {
  kind: TAiRuntimeToolKind;
  patterns: RegExp[];
}

export interface IAiRuntimeToolManifestEntry {
  id: string;
  title: string;
  layer: 'rust' | 'sidecar' | 'frontend';
  capability: string;
  approval: 'none' | 'required';
  argsSchema: unknown;
  resultSchema: unknown;
}

const TOOL_KIND_MATCHERS: readonly IToolKindMatcher[] = [
  {
    kind: 'search',
    patterns: [
      'grep_search',
      'file_search',
      'semantic_search',
      'search_project_files',
      'search_text',
      'search_symbols',
      'grep_in_files',
      'mastra_workspace_list_files',
      'mastra_workspace_grep',
      'list_workspace_entries',
      'directory_tree',
      'sequentialthinking',
    ],
  },
  {
    kind: 'read',
    patterns: [
      'read_file',
      'read_file_window',
      'mastra_workspace_read_file',
      'read_multiple_files',
      'get_file_info',
      'open_nodes',
      'view_image',
      'copilot_getnotebooksummary',
      'get_errors',
      'get_changed_files',
      'terminal_last_command',
      'terminal_selection',
      'mastra_list_logs',
    ],
  },
  {
    kind: 'write',
    patterns: [
      'apply_patch',
      'apply_file_edits',
      'propose_file_patch',
      'mastra_workspace_write_file',
      'mastra_workspace_edit_file',
      'mastra_workspace_ast_edit',
      'create_file',
      'create_directory',
      'edit_notebook_file',
      'create_new_jupyter_notebook',
      'create_new_workspace',
      'vscode_renamesymbol',
      'mcp_pylance_mcp_s_pylanceinvokerefactoring',
      '^memory$',
    ],
  },
  {
    kind: 'git',
    patterns: ['get_changed_files', 'github_repo', 'git_'],
  },
  {
    kind: 'browser',
    patterns: [
      'open_browser_page',
      '^browser_',
      'browser_navigate',
      'browser_evaluate',
      'fetch_webpage',
      'query-docs',
    ],
  },
  {
    kind: 'terminal',
    patterns: [
      'mastra_workspace_execute_command',
      'mastra_workspace_get_process_output',
      'mastra_workspace_kill_process',
      'run_in_terminal',
      'get_terminal_output',
      'send_to_terminal',
      'kill_terminal',
      'create_and_run_task',
    ],
  },
  {
    kind: 'task',
    patterns: [
      'runsubagent',
      'manage_todo_list',
      'vscode_askquestions',
      'test_failure',
      'resolve_memory_file_uri',
    ],
  },
  {
    kind: 'network',
    patterns: [
      'install_extension',
      'run_vscode_command',
      'vscode_searchextensions_internal',
      'container-tools_get-config',
      'configure_python_environment',
      'install_python_packages',
      'get_python_environment_details',
      'get_python_executable_details',
      'create_and_run_task',
      '^web_(?:search|fetch)$',
      '^tavily(?:-|_)',
    ],
  },
  {
    kind: 'diagram',
    patterns: ['rendermermaiddiagram'],
  },
  {
    kind: 'symbol',
    patterns: [
      'vscode_listcodeusages',
      'search_symbols',
      'mastra_workspace_lsp_inspect',
      'vscode_renamesymbol',
      'mcp_pylance_mcp_s_pylancedocstring',
      'mcp_pylance_mcp_s_pylancefilesyntaxerrors',
      'mcp_pylance_mcp_s_pylanceworkspaceuserfiles',
      'mcp_pylance_mcp_s_pylanceimports',
      'mcp_pylance_mcp_s_pylancesettings',
    ],
  },
  {
    kind: 'python',
    patterns: [
      'mcp_pylance_mcp_s_pylanceruncodesnippet',
      'mcp_pylance_mcp_s_pylancesyntaxerrors',
      'mcp_pylance_mcp_s_pylancepythonenvironments',
      'mcp_pylance_mcp_s_pylanceupdatepythonenvironment',
      'mcp_pylance_mcp_s_pylanceinstalledtoplevelmodules',
    ],
  },
  {
    kind: 'java',
    patterns: [
      'debug_java_application',
      'get_debug_session_info',
      'get_debug_threads',
      'get_debug_stack_trace',
      'get_debug_variables',
      'evaluate_debug_expression',
      'debug_step_operation',
      'set_java_breakpoint',
      'remove_java_breakpoints',
      'stop_debug_session',
    ],
  },
  {
    kind: 'memory',
    patterns: ['^memory$', 'resolve_memory_file_uri'],
  },
  {
    kind: 'thinking',
    patterns: ['sequentialthinking', 'thinking', 'reason'],
  },
].map((item) => ({
  kind: item.kind as TAiRuntimeToolKind,
  patterns: item.patterns.map((pattern) => new RegExp(pattern, 'u')),
}));

export const AI_RUNTIME_TOOLS_MANIFEST = [
  {
    id: 'mcp_list_tools',
    title: '列出 MCP 工具',
    layer: 'sidecar',
    capability: 'ai-mcp',
    approval: 'none',
    argsSchema: {
      type: 'object',
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
    },
  },
  {
    id: 'mcp_call_tool',
    title: '调用 MCP 工具',
    layer: 'sidecar',
    capability: 'ai-mcp',
    approval: 'required',
    argsSchema: {
      type: 'object',
      required: ['serverName', 'toolName'],
      properties: {
        serverName: {
          type: 'string',
        },
        toolName: {
          type: 'string',
        },
        arguments: {
          type: 'object',
        },
        input: {
          type: 'object',
        },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
    },
  },
  {
    id: 'web_search',
    title: '联网搜索',
    layer: 'rust',
    capability: 'ai-mcp',
    approval: 'required',
    argsSchema: {
      type: 'object',
    },
    resultSchema: {
      type: 'object',
    },
  },
  {
    id: 'web_fetch',
    title: '读取网页',
    layer: 'rust',
    capability: 'ai-mcp',
    approval: 'required',
    argsSchema: {
      type: 'object',
    },
    resultSchema: {
      type: 'object',
    },
  },
] as readonly IAiRuntimeToolManifestEntry[];

export const normalizeRuntimeToolName = (toolName: string): string =>
  toolName
    .replace(/^mcp\./u, '')
    .replace(/^functions\./u, '')
    .trim();

export const classifyRuntimeToolKind = (toolName: string): TAiRuntimeToolKind => {
  const normalized = normalizeRuntimeToolName(toolName).toLowerCase();

  for (const matcher of TOOL_KIND_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(normalized))) {
      return matcher.kind;
    }
  }

  return 'system';
};
