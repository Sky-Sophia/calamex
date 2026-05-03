import type { IAgentActivity } from '@/types/agent-activity';

export type TToolActionKind =
    | 'read'
    | 'fileSearch'
    | 'symbolSearch'
    | 'diagnose'
    | 'patch'
    | 'applyPatch'
    | 'execute'
    | 'verify'
    | 'git'
    | 'knowledge'
    | 'reasoning'
    | 'time'
    | 'web'
    | 'webFetch'
    | 'tree'
    | 'unknown';

export type TActivityPhaseKey =
    | 'planning'
    | 'safety'
    | 'project_scan'
    | 'files_read'
    | 'files_modify'
    | 'knowledge'
    | 'web'
    | 'git'
    | 'verify'
    | 'summary';

interface IToolCatalogEntry {
    actionKind: TToolActionKind;
    phaseKey: TActivityPhaseKey;
    displayName?: string;
}

export const TOOL_CATALOG: Readonly<Record<string, IToolCatalogEntry>> = {
    read_text_file: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看文本文件',
    },
    read_media_file: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看媒体文件',
    },
    read_multiple_files: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看多个文件',
    },
    read_current_file: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看当前文件',
    },
    read_selected_text: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看选区',
    },
    read_file: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看文件',
    },
    read_project_file: {
        actionKind: 'read',
        phaseKey: 'files_read',
        displayName: '查看项目文件',
    },
    get_file_info: {
        actionKind: 'read',
        phaseKey: 'project_scan',
        displayName: '查看文件信息',
    },
    list_open_files: {
        actionKind: 'read',
        phaseKey: 'summary',
    },
    get_package_scripts: {
        actionKind: 'read',
        phaseKey: 'summary',
    },
    get_test_targets: {
        actionKind: 'read',
        phaseKey: 'summary',
    },
    get_terminal_log: {
        actionKind: 'read',
        phaseKey: 'summary',
    },
    list_project_files: {
        actionKind: 'tree',
        phaseKey: 'project_scan',
        displayName: '查看项目文件',
    },
    list_allowed_directories: {
        actionKind: 'tree',
        phaseKey: 'safety',
        displayName: '查看可访问目录',
    },
    list_directory: {
        actionKind: 'tree',
        phaseKey: 'project_scan',
        displayName: '查看目录',
    },
    list_directory_with_sizes: {
        actionKind: 'tree',
        phaseKey: 'project_scan',
        displayName: '查看目录大小',
    },
    directory_tree: {
        actionKind: 'tree',
        phaseKey: 'project_scan',
        displayName: '查看目录树',
    },
    get_project_tree: {
        actionKind: 'tree',
        phaseKey: 'project_scan',
    },
    search_files: {
        actionKind: 'fileSearch',
        phaseKey: 'project_scan',
        displayName: '文件搜索',
    },
    search_text: {
        actionKind: 'fileSearch',
        phaseKey: 'project_scan',
        displayName: '全文搜索',
    },
    search_project_files: {
        actionKind: 'fileSearch',
        phaseKey: 'project_scan',
        displayName: '项目搜索',
    },
    search_symbols: {
        actionKind: 'symbolSearch',
        phaseKey: 'project_scan',
        displayName: '符号搜索',
    },
    get_diagnostics: {
        actionKind: 'diagnose',
        phaseKey: 'verify',
    },
    propose_patch: {
        actionKind: 'patch',
        phaseKey: 'files_modify',
    },
    auto_apply_patch: {
        actionKind: 'applyPatch',
        phaseKey: 'files_modify',
    },
    write_file: {
        actionKind: 'applyPatch',
        phaseKey: 'files_modify',
    },
    edit_file: {
        actionKind: 'applyPatch',
        phaseKey: 'files_modify',
    },
    create_directory: {
        actionKind: 'applyPatch',
        phaseKey: 'files_modify',
    },
    move_file: {
        actionKind: 'applyPatch',
        phaseKey: 'files_modify',
    },
    delete_file: {
        actionKind: 'execute',
        phaseKey: 'files_modify',
    },
    run_test: {
        actionKind: 'verify',
        phaseKey: 'verify',
    },
    run_command: {
        actionKind: 'execute',
        phaseKey: 'verify',
    },
    run_shell_command: {
        actionKind: 'execute',
        phaseKey: 'verify',
    },
    install_package: {
        actionKind: 'execute',
        phaseKey: 'verify',
    },
    get_git_diff: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_status: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_diff_unstaged: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_diff_staged: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_log: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_show: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_add: {
        actionKind: 'git',
        phaseKey: 'git',
        displayName: '暂存文件',
    },
    git_reset: {
        actionKind: 'git',
        phaseKey: 'safety',
        displayName: '重置 Git',
    },
    git_create_branch: {
        actionKind: 'git',
        phaseKey: 'git',
        displayName: '创建分支',
    },
    git_checkout: {
        actionKind: 'git',
        phaseKey: 'git',
        displayName: '切换分支',
    },
    git_branch: {
        actionKind: 'git',
        phaseKey: 'git',
        displayName: '查看分支',
    },
    stage_file: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    create_commit: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    git_commit: {
        actionKind: 'git',
        phaseKey: 'git',
    },
    create_entities: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '创建实体',
    },
    create_relations: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '创建关系',
    },
    add_observations: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '添加观察',
    },
    delete_entities: {
        actionKind: 'knowledge',
        phaseKey: 'safety',
        displayName: '删除实体',
    },
    delete_observations: {
        actionKind: 'knowledge',
        phaseKey: 'safety',
        displayName: '删除观察',
    },
    delete_relations: {
        actionKind: 'knowledge',
        phaseKey: 'safety',
        displayName: '删除关系',
    },
    read_graph: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '读取知识图谱',
    },
    search_nodes: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '搜索知识节点',
    },
    open_nodes: {
        actionKind: 'knowledge',
        phaseKey: 'knowledge',
        displayName: '打开知识节点',
    },
    sequentialthinking: {
        actionKind: 'reasoning',
        phaseKey: 'planning',
        displayName: '顺序推理',
    },
    get_current_time: {
        actionKind: 'time',
        phaseKey: 'planning',
        displayName: '获取当前时间',
    },
    convert_time: {
        actionKind: 'time',
        phaseKey: 'planning',
        displayName: '转换时间',
    },
    web_search: {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '联网搜索',
    },
    web_fetch: {
        actionKind: 'webFetch',
        phaseKey: 'web',
        displayName: '读取网页',
    },
    'tavily-search': {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '联网搜索',
    },
    'tavily-extract': {
        actionKind: 'webFetch',
        phaseKey: 'web',
        displayName: '读取网页',
    },
    'tavily-map': {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '查看站点地图',
    },
    'tavily-crawl': {
        actionKind: 'webFetch',
        phaseKey: 'web',
        displayName: '抓取站点',
    },
    tavily_search: {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '联网搜索',
    },
    tavily_extract: {
        actionKind: 'webFetch',
        phaseKey: 'web',
        displayName: '读取网页',
    },
    tavily_map: {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '查看站点地图',
    },
    tavily_crawl: {
        actionKind: 'webFetch',
        phaseKey: 'web',
        displayName: '抓取站点',
    },
    tavily_research: {
        actionKind: 'web',
        phaseKey: 'web',
        displayName: '联网调研',
    },
};

export const getActionKind = (toolName: string): TToolActionKind =>
    TOOL_CATALOG[toolName]?.actionKind ?? 'unknown';

export const getToolDisplayName = (toolName: string, fallback: string): string =>
    TOOL_CATALOG[toolName]?.displayName ?? fallback;

export const getPhaseKeyForToolName = (toolName: string): TActivityPhaseKey =>
    TOOL_CATALOG[toolName]?.phaseKey ?? 'summary';

export const getPhaseKeyForActivity = (activity: IAgentActivity): TActivityPhaseKey => {
    const toolName = activity.tool?.name?.trim();

    if (toolName) {
        return getPhaseKeyForToolName(toolName);
    }

    if (activity.kind === 'reasoning_summary' || activity.kind === 'llm') {
        return 'planning';
    }

    if (activity.kind === 'search') {
        const detailLabels = (activity.details ?? []).map((detail) => detail.label).join(' ');
        const searchableText = `${activity.title} ${activity.description ?? ''} ${detailLabels}`;
        return /联网|网页|站点|网址|tavily/iu.test(searchableText) ? 'web' : 'project_scan';
    }

    if (activity.kind === 'read_file') {
        return /目录|项目结构|工作区/u.test(`${activity.title} ${activity.description ?? ''}`)
            ? 'project_scan'
            : 'files_read';
    }

    if (activity.kind === 'edit_file') {
        return 'files_modify';
    }

    if (activity.kind === 'command') {
        return /git/iu.test(`${activity.title} ${activity.command?.command ?? ''}`) ? 'git' : 'verify';
    }

    return activity.kind === 'error' ? 'summary' : 'project_scan';
};