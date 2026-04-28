import type {
    IShellCommandArgumentSpec,
    IShellCommandNodeSpec,
    IShellCommandOptionSpec,
    IShellCommandValueSuggestionSpec,
} from '@/types/shell-completion';

// ---------------------------------------------------------------------------
// Factory config types
// ---------------------------------------------------------------------------

type TCommandConfig = Omit<IShellCommandNodeSpec, 'names' | 'detail'> & {
    aliases?: string[];
};

type TFlagConfig = Omit<IShellCommandOptionSpec, 'names' | 'detail'> & {
    aliases?: string[];
    takesValue?: boolean;
};

type TValueSuggestionConfig = Omit<
    IShellCommandValueSuggestionSpec,
    'names' | 'detail'
> & {
    aliases?: string[];
};

type TArgumentConfig = Omit<IShellCommandArgumentSpec, 'label' | 'detail'>;

type TNamedCatalogSpec = { names: string[] };

// ---------------------------------------------------------------------------
// Name utilities (shared dedupe core)
// ---------------------------------------------------------------------------

/** 把 sources 中的非空、未见名字按出现顺序追加进 target；就地修改 target/seen 并返回 target。 */
const appendUniqueNonEmpty = (
    target: string[],
    sources: Iterable<string>,
    seen: Set<string>,
): string[] => {
    for (const name of sources) {
        if (!name || seen.has(name)) continue;
        seen.add(name);
        target.push(name);
    }
    return target;
};

const toNames = (label: string, aliases?: string[]): string[] =>
    appendUniqueNonEmpty([], [label, ...(aliases ?? [])], new Set());

const mergeNames = (primaryNames: string[], secondaryNames: string[]): string[] =>
    appendUniqueNonEmpty([], [...primaryNames, ...secondaryNames], new Set());

const getPrimaryName = (entry: TNamedCatalogSpec): string => entry.names[0] ?? '';

const getAliases = (entry: TNamedCatalogSpec): string[] => entry.names.slice(1);

const sharesSpecName = (
    leftEntry: TNamedCatalogSpec,
    rightEntry: TNamedCatalogSpec,
): boolean => {
    const leftNames = new Set(leftEntry.names);
    return rightEntry.names.some((name) => leftNames.has(name));
};

// ---------------------------------------------------------------------------
// Option argument shape adapters (`arg` ↔ `args`)
// ---------------------------------------------------------------------------

const toOptionArgumentList = (
    entry: Pick<IShellCommandOptionSpec, 'arg' | 'args'>,
): IShellCommandArgumentSpec[] => {
    if (entry.arg) return [entry.arg];
    return entry.args ?? [];
};

const toOptionArgumentFields = (
    argumentList: IShellCommandArgumentSpec[],
): Pick<IShellCommandOptionSpec, 'arg' | 'args'> => {
    if (argumentList.length === 0) return {};
    if (argumentList.length === 1) return { arg: argumentList[0] };
    return { args: argumentList };
};

/** flag 上的 `takesValue: true` 隐式合成的 value 参数。 */
const synthesizeValueArgument = (
    flagLabel: string,
): IShellCommandArgumentSpec => ({
    label: 'value',
    detail: `${flagLabel} 参数`,
});

// ---------------------------------------------------------------------------
// Spec factories
// ---------------------------------------------------------------------------

const command = (
    label: string,
    detail: string,
    config: TCommandConfig = {},
): IShellCommandNodeSpec => {
    const { aliases, ...restConfig } = config;
    return {
        names: toNames(label, aliases),
        detail,
        ...restConfig,
    };
};

const flag = (
    label: string,
    detail: string,
    config: TFlagConfig = {},
): IShellCommandOptionSpec => {
    const { aliases, takesValue, arg, args, ...restConfig } = config;
    const resolvedArgs =
        args ?? (takesValue ? [synthesizeValueArgument(label)] : undefined);
    const argumentList = toOptionArgumentList({ arg, args: resolvedArgs });

    return {
        names: toNames(label, aliases),
        detail,
        ...restConfig,
        ...toOptionArgumentFields(argumentList),
    };
};

const valueSuggestion = (
    label: string,
    detail: string,
    config: TValueSuggestionConfig = {},
): IShellCommandValueSuggestionSpec => {
    const { aliases, ...restConfig } = config;
    return {
        names: toNames(label, aliases),
        detail,
        ...restConfig,
    };
};

const argument = (
    label: string,
    detail: string,
    config: TArgumentConfig = {},
): IShellCommandArgumentSpec => ({
    label,
    detail,
    ...config,
});

// ---------------------------------------------------------------------------
// Generic "named list" merge skeleton
// ---------------------------------------------------------------------------

/**
 * 通用的"按 `sharesSpecName` 合并 / 否则追加"骨架。
 * 替代原本 `mergeValueSuggestionList`/`mergeOptionList`/`mergeCommandList` 三处重复实现。
 */
const mergeNamedList = <T extends TNamedCatalogSpec>(
    baseList: T[],
    overrideList: T[],
    mergeEntry: (baseEntry: T, overrideEntry: T) => T,
): T[] => {
    const mergedList = [...baseList];

    for (const overrideEntry of overrideList) {
        const matchedIndex = mergedList.findIndex((baseEntry) =>
            sharesSpecName(baseEntry, overrideEntry),
        );
        if (matchedIndex === -1) {
            mergedList.push(overrideEntry);
            continue;
        }
        mergedList[matchedIndex] = mergeEntry(
            mergedList[matchedIndex],
            overrideEntry,
        );
    }

    return mergedList;
};

// ---------------------------------------------------------------------------
// Spec-level merges
// ---------------------------------------------------------------------------

const mergeValueSuggestionSpec = (
    baseSuggestionSpec: IShellCommandValueSuggestionSpec,
    overrideSuggestionSpec: IShellCommandValueSuggestionSpec,
): IShellCommandValueSuggestionSpec => ({
    names: mergeNames(overrideSuggestionSpec.names, baseSuggestionSpec.names),
    detail: overrideSuggestionSpec.detail || baseSuggestionSpec.detail,
    insertText: overrideSuggestionSpec.insertText ?? baseSuggestionSpec.insertText,
    insertAsSnippet:
        overrideSuggestionSpec.insertAsSnippet ?? baseSuggestionSpec.insertAsSnippet,
    priority: overrideSuggestionSpec.priority ?? baseSuggestionSpec.priority,
});

const mergeValueSuggestionList = (
    baseSuggestionList: IShellCommandValueSuggestionSpec[],
    overrideSuggestionList: IShellCommandValueSuggestionSpec[],
): IShellCommandValueSuggestionSpec[] =>
    mergeNamedList(baseSuggestionList, overrideSuggestionList, mergeValueSuggestionSpec);

const mergeArgumentSpec = (
    baseArgumentSpec: IShellCommandArgumentSpec,
    overrideArgumentSpec: IShellCommandArgumentSpec,
): IShellCommandArgumentSpec => ({
    label: overrideArgumentSpec.label || baseArgumentSpec.label,
    detail: overrideArgumentSpec.detail || baseArgumentSpec.detail,
    isOptional: overrideArgumentSpec.isOptional ?? baseArgumentSpec.isOptional,
    isVariadic: overrideArgumentSpec.isVariadic ?? baseArgumentSpec.isVariadic,
    suggestions: mergeValueSuggestionList(
        baseArgumentSpec.suggestions ?? [],
        overrideArgumentSpec.suggestions ?? [],
    ),
});

const mergeArgumentList = (
    baseArgumentList: IShellCommandArgumentSpec[],
    overrideArgumentList: IShellCommandArgumentSpec[],
): IShellCommandArgumentSpec[] => {
    if (baseArgumentList.length === 0) return overrideArgumentList;
    if (overrideArgumentList.length === 0) return baseArgumentList;

    const mergedLength = Math.max(
        baseArgumentList.length,
        overrideArgumentList.length,
    );

    const mergedArgumentList: IShellCommandArgumentSpec[] = [];
    for (let index = 0; index < mergedLength; index += 1) {
        const baseArgument = baseArgumentList[index];
        const overrideArgument = overrideArgumentList[index];

        if (baseArgument && overrideArgument) {
            mergedArgumentList.push(mergeArgumentSpec(baseArgument, overrideArgument));
        } else if (overrideArgument) {
            mergedArgumentList.push(overrideArgument);
        } else if (baseArgument) {
            mergedArgumentList.push(baseArgument);
        }
    }
    return mergedArgumentList;
};

const mergeOptionSpec = (
    baseOptionSpec: IShellCommandOptionSpec,
    overrideOptionSpec: IShellCommandOptionSpec,
): IShellCommandOptionSpec => {
    const mergedArgumentList = mergeArgumentList(
        toOptionArgumentList(baseOptionSpec),
        toOptionArgumentList(overrideOptionSpec),
    );

    return {
        names: mergeNames(overrideOptionSpec.names, baseOptionSpec.names),
        detail: overrideOptionSpec.detail || baseOptionSpec.detail,
        insertText: overrideOptionSpec.insertText ?? baseOptionSpec.insertText,
        insertAsSnippet:
            overrideOptionSpec.insertAsSnippet ?? baseOptionSpec.insertAsSnippet,
        priority: overrideOptionSpec.priority ?? baseOptionSpec.priority,
        ...toOptionArgumentFields(mergedArgumentList),
    };
};

const mergeOptionList = (
    baseOptionList: IShellCommandOptionSpec[],
    overrideOptionList: IShellCommandOptionSpec[],
): IShellCommandOptionSpec[] =>
    mergeNamedList(baseOptionList, overrideOptionList, mergeOptionSpec);

const mergeCommandNode = (
    baseCommandNode: IShellCommandNodeSpec,
    overrideCommandNode: IShellCommandNodeSpec,
): IShellCommandNodeSpec => ({
    names: mergeNames(overrideCommandNode.names, baseCommandNode.names),
    detail: overrideCommandNode.detail || baseCommandNode.detail,
    priority: overrideCommandNode.priority ?? baseCommandNode.priority,
    args: mergeArgumentList(
        baseCommandNode.args ?? [],
        overrideCommandNode.args ?? [],
    ),
    flags: mergeOptionList(
        baseCommandNode.flags ?? [],
        overrideCommandNode.flags ?? [],
    ),
    subcommands: mergeCommandList(
        baseCommandNode.subcommands ?? [],
        overrideCommandNode.subcommands ?? [],
    ),
});

const mergeCommandList = (
    baseCommandList: IShellCommandNodeSpec[],
    overrideCommandList: IShellCommandNodeSpec[],
): IShellCommandNodeSpec[] =>
    mergeNamedList(baseCommandList, overrideCommandList, mergeCommandNode);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const mergeCommandCatalogs = (
    baseCommandCatalog: IShellCommandNodeSpec[],
    overrideCommandCatalog: IShellCommandNodeSpec[],
): IShellCommandNodeSpec[] =>
    mergeCommandList(baseCommandCatalog, overrideCommandCatalog);

const commandSuggestions = (
    commandEntries: IShellCommandNodeSpec[],
): IShellCommandValueSuggestionSpec[] =>
    commandEntries.map((entry) =>
        valueSuggestion(getPrimaryName(entry), entry.detail ?? '', {
            aliases: getAliases(entry),
        }),
    );

// ---------------------------------------------------------------------------
// Resource / suggestion catalogs (data — preserved verbatim)
// ---------------------------------------------------------------------------

const KUBERNETES_RESOURCE_COMMANDS: IShellCommandNodeSpec[] = [
    command('pods', 'Pod 资源', { aliases: ['po'] }),
    command('deployments', 'Deployment 资源', { aliases: ['deploy', 'dep'] }),
    command('services', 'Service 资源', { aliases: ['svc'] }),
    command('namespaces', 'Namespace 资源', { aliases: ['ns'] }),
    command('nodes', 'Node 资源', { aliases: ['no'] }),
    command('configmaps', 'ConfigMap 资源', { aliases: ['cm'] }),
    command('secrets', 'Secret 资源', { aliases: ['secret'] }),
    command('jobs', 'Job 资源', { aliases: ['job'] }),
    command('cronjobs', 'CronJob 资源', { aliases: ['cj'] }),
    command('ingresses', 'Ingress 资源', { aliases: ['ing'] }),
    command('daemonsets', 'DaemonSet 资源', { aliases: ['ds'] }),
    command('statefulsets', 'StatefulSet 资源', { aliases: ['sts'] }),
    command('replicasets', 'ReplicaSet 资源', { aliases: ['rs'] }),
    command('persistentvolumeclaims', 'PersistentVolumeClaim 资源', { aliases: ['pvc'] }),
    command('persistentvolumes', 'PersistentVolume 资源', { aliases: ['pv'] }),
];

const PACKAGE_ACCESS_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('public', '公开发布包'),
    valueSuggestion('restricted', '受限范围发布包'),
];

const PACKAGE_TAG_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('latest', '默认稳定发布标签'),
    valueSuggestion('next', '下一稳定线预发布标签'),
    valueSuggestion('beta', 'Beta 预发布标签'),
    valueSuggestion('alpha', 'Alpha 预发布标签'),
    valueSuggestion('canary', 'Canary 试验标签'),
    valueSuggestion('rc', 'Release Candidate 标签'),
];

const PACKAGE_SCRIPT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('dev', '启动开发脚本'),
    valueSuggestion('build', '执行构建脚本'),
    valueSuggestion('test', '执行测试脚本'),
    valueSuggestion('lint', '执行 lint 脚本'),
    valueSuggestion('start', '执行启动脚本'),
    valueSuggestion('preview', '执行预览脚本'),
    valueSuggestion('typecheck', '执行类型检查脚本'),
];

const GIT_BRANCH_NAME_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('main', '主分支命名'),
    valueSuggestion('master', '传统主分支命名'),
    valueSuggestion('develop', '开发主线分支'),
    valueSuggestion('dev', '简写开发分支'),
    valueSuggestion('release', '发布分支'),
];

const GIT_RESTORE_SOURCE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('HEAD', '当前检出提交'),
    valueSuggestion('HEAD~1', '上一个提交'),
    valueSuggestion('ORIG_HEAD', '上一个危险操作前的引用'),
    valueSuggestion('FETCH_HEAD', '最近一次抓取的远端引用'),
];

const GIT_DATE_FORMAT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('default', '默认日期格式'),
    valueSuggestion('relative', '相对时间格式'),
    valueSuggestion('local', '本地化日期格式'),
    valueSuggestion('iso', 'ISO 日期格式'),
    valueSuggestion('iso-strict', '严格 ISO 日期格式'),
    valueSuggestion('short', '短日期格式'),
    valueSuggestion('raw', '原始时间戳格式'),
    valueSuggestion('human', '易读日期格式'),
    valueSuggestion('unix', 'Unix 时间戳格式'),
];

// 🔧 NOTE: 'user.name' 已修复（原版被粘贴板自动加链成 '[user.name](http://user.name/)'）
const GIT_CONFIG_KEY_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('user.name', 'Git 用户名配置项'),
    valueSuggestion('user.email', 'Git 用户邮箱配置项'),
    valueSuggestion('core.editor', '默认编辑器配置项'),
    valueSuggestion('init.defaultBranch', '默认分支名配置项'),
    valueSuggestion('pull.rebase', '拉取时默认 rebase 配置项'),
    valueSuggestion('push.autoSetupRemote', '首次推送自动建立 upstream'),
    valueSuggestion('fetch.prune', '抓取后自动清理失效远端引用'),
    valueSuggestion('merge.ff', '合并 fast-forward 策略'),
];

const DOCKER_LOG_LEVEL_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('debug', '调试级别日志'),
    valueSuggestion('info', '信息级别日志'),
    valueSuggestion('warn', '警告级别日志'),
    valueSuggestion('error', '错误级别日志'),
    valueSuggestion('fatal', '致命错误级别日志'),
];

const DOCKER_FORMAT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('table', '表格输出'),
    valueSuggestion('json', 'JSON 输出'),
    valueSuggestion('table .Names\\t.Status', '按名称和状态展示'),
    valueSuggestion('json .', '逐项输出 JSON'),
];

const DOCKER_STATUS_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('created', '仅显示已创建容器'),
    valueSuggestion('running', '仅显示运行中的容器'),
    valueSuggestion('paused', '仅显示暂停中的容器'),
    valueSuggestion('restarting', '仅显示重启中的容器'),
    valueSuggestion('removing', '仅显示删除中的容器'),
    valueSuggestion('exited', '仅显示已退出容器'),
    valueSuggestion('dead', '仅显示异常死亡容器'),
];

const DOCKER_IMAGE_PRUNE_MODE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('local', '仅移除未打标签的镜像'),
    valueSuggestion('all', '移除所有未使用镜像'),
];

const DOCKER_NETWORK_DRIVER_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('bridge', '默认桥接网络驱动'),
    valueSuggestion('host', '直接共享宿主机网络'),
    valueSuggestion('overlay', '多主机 overlay 网络'),
    valueSuggestion('macvlan', '为容器分配 MAC 地址'),
    valueSuggestion('ipvlan', '基于 IP 的轻量网络驱动'),
    valueSuggestion('none', '不配置网络'),
];

const DOCKER_PLATFORM_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('linux/amd64', 'Linux x86_64 平台'),
    valueSuggestion('linux/arm64', 'Linux ARM64 平台'),
    valueSuggestion('linux/arm/v7', 'Linux ARM v7 平台'),
    valueSuggestion('linux/386', 'Linux x86 平台'),
    valueSuggestion('windows/amd64', 'Windows x86_64 平台'),
];

const DOCKER_SCALE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('web=2', '把 web 服务扩容到 2 个副本'),
    valueSuggestion('worker=3', '把 worker 服务扩容到 3 个副本'),
    valueSuggestion('SERVICE=COUNT', '自定义服务扩容表达式', {
        insertText: '${1:service}=${2:2}',
        insertAsSnippet: true,
    }),
];

const DOCKER_PORT_MAPPING_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('8080:80', '将宿主机 8080 映射到容器 80'),
    valueSuggestion('127.0.0.1:8080:80', '仅绑定回环地址的端口映射'),
    valueSuggestion('HOST:CONTAINER', '自定义端口映射', {
        insertText: '${1:8080}:${2:80}',
        insertAsSnippet: true,
    }),
];

const DOCKER_VOLUME_MAPPING_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('${PWD}:/app', '把当前目录挂载到容器 /app'),
    valueSuggestion('named-volume:/data', '把命名卷挂载到容器 /data'),
    valueSuggestion('HOST_PATH:CONTAINER_PATH', '自定义卷挂载', {
        insertText: '${1:${PWD}}:${2:/app}',
        insertAsSnippet: true,
    }),
];

const DOCKER_RUN_NETWORK_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('bridge', '接入默认 bridge 网络'),
    valueSuggestion('host', '共享宿主机网络'),
    valueSuggestion('none', '禁用容器网络'),
];

const KUBERNETES_RESOURCE_SUGGESTIONS = commandSuggestions(KUBERNETES_RESOURCE_COMMANDS);

const KUBECTL_OUTPUT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('json', 'JSON 输出'),
    valueSuggestion('yaml', 'YAML 输出'),
    valueSuggestion('wide', '宽表格输出'),
    valueSuggestion('name', '仅输出资源名称'),
    valueSuggestion('go-template', 'Go Template 输出'),
    valueSuggestion('go-template-file', '从文件读取 Go Template'),
    valueSuggestion('jsonpath', 'JSONPath 输出'),
    valueSuggestion('jsonpath-as-json', '按 JSON 输出 JSONPath 结果'),
    valueSuggestion('jsonpath-file', '从文件读取 JSONPath'),
    valueSuggestion('custom-columns', '自定义列输出'),
    valueSuggestion('custom-columns-file', '从文件读取自定义列定义'),
];

const KUBECTL_DRY_RUN_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('none', '关闭 dry-run'),
    valueSuggestion('client', '仅在客户端做 dry-run'),
    valueSuggestion('server', '在服务端做 dry-run'),
];

const KUBECTL_SERVICE_TYPE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('ClusterIP', '集群内访问的默认服务类型'),
    valueSuggestion('NodePort', '在节点端口暴露服务'),
    valueSuggestion('LoadBalancer', '通过云厂商负载均衡暴露服务'),
    valueSuggestion('ExternalName', '将服务映射到外部 DNS 名称'),
];

const KUBECTL_WAIT_CONDITION_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('create', '等待资源被创建'),
    valueSuggestion('delete', '等待资源被删除'),
    valueSuggestion('condition=Ready', '等待资源进入 Ready 状态'),
    valueSuggestion('condition=Available', '等待资源进入 Available 状态'),
    valueSuggestion('condition=Complete', '等待任务执行完成'),
    valueSuggestion('jsonpath={.status.phase}=Running', '等待 Pod 运行中'),
];

const KUBECTL_TIMEOUT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('30s', '30 秒超时'),
    valueSuggestion('1m', '1 分钟超时'),
    valueSuggestion('5m', '5 分钟超时'),
    valueSuggestion('10m', '10 分钟超时'),
];

const KUBECTL_AUTH_VERB_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('get', '读取单个资源'),
    valueSuggestion('list', '列出资源'),
    valueSuggestion('watch', '监听资源变化'),
    valueSuggestion('create', '创建资源'),
    valueSuggestion('update', '更新资源'),
    valueSuggestion('patch', '局部更新资源'),
    valueSuggestion('delete', '删除资源'),
    valueSuggestion('exec', '在容器中执行命令'),
];

const SYSTEMD_OUTPUT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('short', '简短输出格式'),
    valueSuggestion('short-full', '完整短格式输出'),
    valueSuggestion('short-iso', 'ISO 时间格式输出'),
    valueSuggestion('short-precise', '高精度短格式输出'),
    valueSuggestion('verbose', '详细输出'),
    valueSuggestion('json', 'JSON 输出'),
    valueSuggestion('json-pretty', '格式化 JSON 输出'),
    valueSuggestion('cat', '按 cat 风格输出'),
];

const SYSTEMD_UNIT_TYPE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('service', '服务单元'),
    valueSuggestion('socket', '套接字单元'),
    valueSuggestion('target', '目标单元'),
    valueSuggestion('mount', '挂载单元'),
    valueSuggestion('timer', '定时器单元'),
    valueSuggestion('path', '路径单元'),
    valueSuggestion('automount', '自动挂载单元'),
    valueSuggestion('swap', '交换分区单元'),
    valueSuggestion('device', '设备单元'),
    valueSuggestion('scope', '作用域单元'),
    valueSuggestion('slice', '切片单元'),
    valueSuggestion('snapshot', '快照单元'),
];

const SYSTEMD_UNIT_STATE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('active', '当前活跃的单元'),
    valueSuggestion('inactive', '当前未激活的单元'),
    valueSuggestion('failed', '执行失败的单元'),
    valueSuggestion('activating', '正在激活的单元'),
    valueSuggestion('deactivating', '正在停用的单元'),
    valueSuggestion('reloading', '正在重载的单元'),
    valueSuggestion('maintenance', '维护状态单元'),
];

const SYSTEMD_UNIT_FILE_STATE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('enabled', '开机启用的单元文件'),
    valueSuggestion('enabled-runtime', '运行时启用的单元文件'),
    valueSuggestion('linked', '已链接的单元文件'),
    valueSuggestion('linked-runtime', '运行时已链接的单元文件'),
    valueSuggestion('alias', '别名单元文件'),
    valueSuggestion('masked', '被 mask 的单元文件'),
    valueSuggestion('masked-runtime', '运行时被 mask 的单元文件'),
    valueSuggestion('static', '静态单元文件'),
    valueSuggestion('disabled', '未启用的单元文件'),
    valueSuggestion('indirect', '间接启用的单元文件'),
    valueSuggestion('generated', '动态生成的单元文件'),
    valueSuggestion('transient', '临时单元文件'),
    valueSuggestion('bad', '无效单元文件'),
];

const SSH_OPTION_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('StrictHostKeyChecking=no', '关闭首次连接主机指纹确认'),
    valueSuggestion('UserKnownHostsFile=/dev/null', '不写入 known_hosts'),
    valueSuggestion('ServerAliveInterval=30', '每 30 秒发送一次保活'),
    valueSuggestion('ServerAliveCountMax=3', '保活失败 3 次后断开'),
    valueSuggestion('ConnectTimeout=10', '连接超时设置为 10 秒'),
    valueSuggestion('IdentitiesOnly=yes', '仅使用指定私钥认证'),
    valueSuggestion('LogLevel=ERROR', '降低 SSH 日志输出级别'),
    valueSuggestion('PreferredAuthentications=publickey,password', '指定认证顺序'),
    valueSuggestion('ProxyJump=bastion', '通过跳板机连接目标主机', {
        insertText: 'ProxyJump=${1:bastion}',
        insertAsSnippet: true,
    }),
    valueSuggestion('ProxyCommand=ssh -W %h:%p bastion', '通过 ProxyCommand 使用跳板机', {
        insertText: 'ProxyCommand=ssh -W %h:%p ${1:bastion}',
        insertAsSnippet: true,
    }),
];

const SSH_LOCAL_FORWARD_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('8080:127.0.0.1:80', '把本地 8080 转发到远端 80 端口'),
    valueSuggestion('LOCAL:HOST:REMOTE', '自定义本地端口转发', {
        insertText: '${1:8080}:${2:127.0.0.1}:${3:80}',
        insertAsSnippet: true,
    }),
];

const SSH_REMOTE_FORWARD_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('2222:127.0.0.1:22', '把远端 2222 转发回本地 22 端口'),
    valueSuggestion('REMOTE:HOST:LOCAL', '自定义远端端口转发', {
        insertText: '${1:2222}:${2:127.0.0.1}:${3:22}',
        insertAsSnippet: true,
    }),
];

const SSH_DYNAMIC_FORWARD_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('1080', '在本地 1080 端口开启 SOCKS 代理'),
    valueSuggestion('127.0.0.1:1080', '仅绑定回环地址的 SOCKS 代理'),
];

const CURL_METHOD_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('GET', 'GET 请求'),
    valueSuggestion('POST', 'POST 请求'),
    valueSuggestion('PUT', 'PUT 请求'),
    valueSuggestion('PATCH', 'PATCH 请求'),
    valueSuggestion('DELETE', 'DELETE 请求'),
    valueSuggestion('HEAD', 'HEAD 请求'),
    valueSuggestion('OPTIONS', 'OPTIONS 请求'),
];

const CURL_HEADER_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('Content-Type: application/json', '声明 JSON 请求体'),
    valueSuggestion('Accept: application/json', '声明接收 JSON 响应'),
    valueSuggestion('Authorization: Bearer TOKEN', '插入 Bearer Token 认证头', {
        insertText: 'Authorization: Bearer ${1:TOKEN}',
        insertAsSnippet: true,
    }),
];

const CURL_FORM_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('name=value', '提交普通表单字段', {
        insertText: '${1:name}=${2:value}',
        insertAsSnippet: true,
    }),
    valueSuggestion('file=@path', '上传文件表单字段', {
        insertText: '${1:file}=@${2:path}',
        insertAsSnippet: true,
    }),
];

const CURL_AUTH_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('user:password', 'Basic 认证凭据', {
        insertText: '${1:user}:${2:password}',
        insertAsSnippet: true,
    }),
];

const JOURNAL_PRIORITY_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('emerg', '系统不可用级别'),
    valueSuggestion('alert', '需要立即处理的级别'),
    valueSuggestion('crit', '严重错误级别'),
    valueSuggestion('err', '错误级别'),
    valueSuggestion('warning', '警告级别'),
    valueSuggestion('notice', '普通但重要的级别'),
    valueSuggestion('info', '信息级别'),
    valueSuggestion('debug', '调试级别'),
];

const JOURNAL_OUTPUT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('short', '简短输出格式'),
    valueSuggestion('short-iso', 'ISO 时间格式输出'),
    valueSuggestion('short-precise', '高精度时间输出'),
    valueSuggestion('verbose', '详细输出'),
    valueSuggestion('json', 'JSON 输出'),
    valueSuggestion('json-pretty', '格式化 JSON 输出'),
    valueSuggestion('cat', '仅输出消息体'),
    valueSuggestion('with-unit', '输出消息并包含 unit 信息'),
];

const JOURNAL_TIME_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('today', '当天起始时间'),
    valueSuggestion('yesterday', '昨天起始时间'),
    valueSuggestion('-1h', '最近 1 小时'),
    valueSuggestion('-24h', '最近 24 小时'),
    valueSuggestion('-7d', '最近 7 天'),
];

const FIND_TYPE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('f', '普通文件'),
    valueSuggestion('d', '目录'),
    valueSuggestion('l', '符号链接'),
    valueSuggestion('c', '字符设备'),
    valueSuggestion('b', '块设备'),
    valueSuggestion('s', '套接字'),
    valueSuggestion('p', '命名管道'),
];

const AWK_FIELD_SEPARATOR_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion(',', '逗号分隔'),
    valueSuggestion('\\t', 'Tab 分隔'),
    valueSuggestion('|', '竖线分隔'),
    valueSuggestion(':', '冒号分隔'),
];

const AWK_VARIABLE_ASSIGNMENT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('FS=,', '设置输入字段分隔符为逗号'),
    valueSuggestion('OFS=,', '设置输出字段分隔符为逗号'),
    valueSuggestion('IGNORECASE=1', '开启大小写不敏感匹配'),
];

const CARGO_TARGET_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('x86_64-unknown-linux-gnu', 'Linux x86_64 目标三元组'),
    valueSuggestion('aarch64-unknown-linux-gnu', 'Linux ARM64 目标三元组'),
    valueSuggestion('x86_64-pc-windows-msvc', 'Windows MSVC 目标三元组'),
    valueSuggestion('x86_64-apple-darwin', 'macOS Intel 目标三元组'),
    valueSuggestion('aarch64-apple-darwin', 'macOS Apple Silicon 目标三元组'),
    valueSuggestion('wasm32-unknown-unknown', 'WebAssembly 目标三元组'),
];

const CARGO_TREE_EDGE_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('normal', '普通依赖边'),
    valueSuggestion('build', '构建依赖边'),
    valueSuggestion('dev', '开发依赖边'),
    valueSuggestion('all', '显示全部依赖边'),
    valueSuggestion('features', '显示 feature 边'),
    valueSuggestion('no-normal', '排除普通依赖边'),
    valueSuggestion('no-build', '排除构建依赖边'),
    valueSuggestion('no-dev', '排除开发依赖边'),
    valueSuggestion('no-proc-macro', '排除 proc-macro 依赖边'),
];

const PYTHON_WARNING_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('default', '默认 warning 处理策略'),
    valueSuggestion('error', '把 warning 视为错误'),
    valueSuggestion('ignore', '忽略 warning'),
    valueSuggestion('always', '始终输出 warning'),
    valueSuggestion('module', '每个模块输出一次 warning'),
    valueSuggestion('once', '仅输出一次 warning'),
];

const PIP_LIST_FORMAT_SUGGESTIONS: IShellCommandValueSuggestionSpec[] = [
    valueSuggestion('columns', '按列输出结果'),
    valueSuggestion('freeze', '按 requirements.txt 格式输出'),
    valueSuggestion('json', '按 JSON 输出结果'),
];

const PACKAGE_MANAGER_COMMANDS: IShellCommandNodeSpec[] = [
    command('install', '安装依赖包', {
        aliases: ['i'],
        flags: [
            flag('--save-dev', '安装为开发依赖'),
            flag('--global', '全局安装依赖'),
            flag('--frozen-lockfile', '锁文件严格校验'),
            flag('--offline', '离线安装'),
        ],
    }),
    command('add', '添加依赖包', {
        flags: [
            flag('--save-dev', '安装为开发依赖'),
            flag('--global', '全局安装依赖'),
            flag('--exact', '固定版本安装'),
        ],
    }),
    command('remove', '移除依赖包', {
        aliases: ['rm'],
        flags: [flag('--global', '从全局依赖中移除')],
    }),
    command('update', '更新依赖包', {
        aliases: ['up'],
        flags: [
            flag('--latest', '升级到最新版本'),
            flag('--interactive', '交互式选择升级项'),
        ],
    }),
    command('run', '运行 package.json 脚本', {
        args: [argument('script', '脚本名称', { suggestions: PACKAGE_SCRIPT_SUGGESTIONS })],
        flags: [flag('--if-present', '脚本不存在时跳过')],
    }),
    command('exec', '在项目环境中执行命令', {
        flags: [flag('--package', '指定临时包', { takesValue: true })],
    }),
    command('test', '执行测试脚本'),
    command('build', '执行构建脚本'),
    command('dev', '执行开发脚本'),
    command('start', '执行启动脚本'),
    command('lint', '执行 lint 脚本'),
    command('create', '创建脚手架项目'),
    command('publish', '发布包到仓库', {
        flags: [
            flag('--access', '指定访问级别', {
                takesValue: true,
                args: [argument('access', '发布访问级别', { suggestions: PACKAGE_ACCESS_SUGGESTIONS })],
            }),
            flag('--tag', '指定发布 tag', {
                takesValue: true,
                args: [argument('tag', '发布标签', { suggestions: PACKAGE_TAG_SUGGESTIONS })],
            }),
        ],
    }),
    command('init', '初始化项目'),
    command('audit', '审计依赖安全问题'),
    command('list', '查看依赖树', {
        aliases: ['ls'],
        flags: [flag('--depth', '限制依赖深度', { takesValue: true })],
    }),
    command('outdated', '查看过期依赖'),
    command('cache', '管理包缓存', {
        subcommands: [
            command('clean', '清理缓存'),
            command('verify', '校验缓存'),
            command('list', '查看缓存条目'),
            command('prune', '清理未引用缓存'),
        ],
    }),
    command('config', '管理包管理器配置', {
        subcommands: [
            command('get', '读取配置项'),
            command('set', '设置配置项'),
            command('delete', '删除配置项'),
            command('list', '查看全部配置'),
        ],
    }),
];

// ---------------------------------------------------------------------------
// Top-level shell command catalog
// ---------------------------------------------------------------------------

export const LOCAL_SHELL_COMMAND_CATALOG: IShellCommandNodeSpec[] = [
    command('git', 'Git 版本控制命令', {
        flags: [
            flag('-C', '切换到指定工作目录后执行', { takesValue: true }),
            flag('-c', '临时设置 Git 配置项', { takesValue: true }),
            flag('--git-dir', '指定 Git 目录', { takesValue: true }),
            flag('--work-tree', '指定工作树目录', { takesValue: true }),
            flag('--no-pager', '禁用分页器'),
            flag('--version', '显示 Git 版本信息'),
            flag('--help', '查看帮助信息'),
        ],
        subcommands: [
            command('add', '添加文件到暂存区', {
                flags: [
                    flag('-A', '暂存全部改动'),
                    flag('-u', '仅更新已跟踪文件'),
                    flag('-p', '交互式暂存'),
                    flag('--all', '暂存全部改动'),
                ],
            }),
            command('branch', '管理分支', {
                flags: [
                    flag('-a', '显示本地与远端分支'),
                    flag('-r', '仅显示远端分支'),
                    flag('-d', '删除已合并分支'),
                    flag('-D', '强制删除分支'),
                    flag('-m', '重命名分支'),
                    flag('-M', '强制重命名分支'),
                ],
            }),
            command('checkout', '切换分支或恢复文件', {
                flags: [
                    flag('-b', '新建并切换分支'),
                    flag('-B', '强制重建分支'),
                    flag('--detach', '以 detached HEAD 模式切换'),
                    flag('--', '后续参数解释为路径'),
                ],
            }),
            command('clone', '克隆仓库', {
                flags: [
                    flag('--depth', '浅克隆深度', { takesValue: true }),
                    flag('--branch', '指定分支', { takesValue: true }),
                    flag('--single-branch', '仅克隆单个分支'),
                    flag('--recurse-submodules', '递归拉取子模块'),
                ],
            }),
            command('commit', '提交暂存内容', {
                flags: [
                    flag('-m', '提交说明', { takesValue: true }),
                    flag('-a', '自动暂存已跟踪文件'),
                    flag('--amend', '修改最近一次提交'),
                    flag('--no-edit', '保留原提交说明'),
                    flag('--signoff', '追加 Signed-off-by 信息'),
                    flag('--fixup', '创建 fixup 提交', { takesValue: true }),
                ],
            }),
            command('config', '管理 Git 配置', {
                subcommands: [
                    command('get', '读取配置项', {
                        args: [argument('name', 'Git 配置键', { suggestions: GIT_CONFIG_KEY_SUGGESTIONS })],
                    }),
                    command('set', '设置配置项', {
                        args: [argument('name', 'Git 配置键', { suggestions: GIT_CONFIG_KEY_SUGGESTIONS })],
                    }),
                    command('unset', '删除配置项', {
                        args: [argument('name', 'Git 配置键', { suggestions: GIT_CONFIG_KEY_SUGGESTIONS })],
                    }),
                    command('list', '查看所有配置'),
                    command('edit', '编辑配置文件'),
                ],
            }),
            command('diff', '查看差异', {
                flags: [
                    flag('--cached', '比较暂存区与 HEAD'),
                    flag('--staged', '比较暂存区与 HEAD'),
                    flag('--stat', '显示统计信息'),
                    flag('--name-only', '仅显示文件名'),
                    flag('--color-words', '按单词高亮差异'),
                ],
            }),
            command('fetch', '拉取远端引用', {
                flags: [
                    flag('--all', '拉取所有远端'),
                    flag('--prune', '删除失效远端引用'),
                    flag('--tags', '同时拉取标签'),
                    flag('--depth', '限制历史深度', { takesValue: true }),
                ],
            }),
            command('init', '初始化仓库', {
                flags: [
                    flag('--bare', '创建裸仓库'),
                    flag('--initial-branch', '设置默认分支名', {
                        takesValue: true,
                        args: [argument('branch', '默认分支名', { suggestions: GIT_BRANCH_NAME_SUGGESTIONS })],
                    }),
                ],
            }),
            command('log', '查看提交历史', {
                flags: [
                    flag('--oneline', '单行显示提交'),
                    flag('--graph', '显示提交图谱'),
                    flag('--decorate', '显示引用装饰'),
                    flag('-p', '显示详细补丁'),
                    flag('--stat', '显示文件变更统计'),
                    flag('--since', '限制起始时间', { takesValue: true }),
                    flag('--author', '按作者过滤', { takesValue: true }),
                ],
            }),
            command('merge', '合并分支', {
                flags: [
                    flag('--no-ff', '禁用 fast-forward'),
                    flag('--ff-only', '仅允许 fast-forward'),
                    flag('--squash', '压缩合并'),
                    flag('--abort', '中止当前合并'),
                    flag('--continue', '继续当前合并'),
                ],
            }),
            command('pull', '拉取并合并远端更新', {
                flags: [
                    flag('--rebase', '使用 rebase 代替 merge'),
                    flag('--ff-only', '仅允许 fast-forward'),
                    flag('--tags', '同时拉取标签'),
                ],
            }),
            command('push', '推送本地提交', {
                flags: [
                    flag('-u', '设置上游分支'),
                    flag('--force-with-lease', '带保护地强制推送'),
                    flag('--tags', '同时推送标签'),
                    flag('--delete', '删除远端引用'),
                ],
            }),
            command('rebase', '变基提交历史', {
                flags: [
                    flag('-i', '交互式 rebase'),
                    flag('--abort', '中止当前 rebase'),
                    flag('--continue', '继续当前 rebase'),
                    flag('--skip', '跳过当前提交'),
                    flag('--onto', '指定新的基底', { takesValue: true }),
                ],
            }),
            command('remote', '管理远端仓库', {
                flags: [flag('-v', '显示远端 URL')],
                subcommands: [
                    command('add', '新增远端'),
                    command('remove', '删除远端'),
                    command('rename', '重命名远端'),
                    command('set-url', '设置远端 URL'),
                    command('show', '查看远端详情'),
                    command('prune', '清理失效引用'),
                    command('update', '更新远端引用'),
                    command('get-url', '查看远端 URL'),
                ],
            }),
            command('reset', '重置 HEAD 或暂存区', {
                flags: [
                    flag('--soft', '仅移动 HEAD'),
                    flag('--mixed', '重置暂存区'),
                    flag('--hard', '重置工作区与暂存区'),
                ],
            }),
            command('restore', '恢复工作区或暂存区文件', {
                flags: [
                    flag('--staged', '恢复暂存区内容'),
                    flag('--source', '指定恢复来源', {
                        takesValue: true,
                        args: [argument('treeish', '恢复来源引用', { suggestions: GIT_RESTORE_SOURCE_SUGGESTIONS })],
                    }),
                    flag('--worktree', '恢复工作区文件'),
                ],
            }),
            command('show', '查看对象详情', {
                flags: [flag('--stat', '显示统计信息'), flag('--name-only', '仅显示文件名')],
            }),
            command('status', '查看工作区状态', {
                flags: [
                    flag('-s', '简短模式'),
                    flag('--short', '简短模式'),
                    flag('-b', '显示分支信息'),
                    flag('--branch', '显示分支信息'),
                    flag('--porcelain', '机器可读格式'),
                ],
            }),
            command('stash', '临时保存工作区改动', {
                flags: [
                    flag('-u', '包含未跟踪文件'),
                    flag('--include-untracked', '包含未跟踪文件'),
                    flag('--all', '包含忽略文件'),
                    flag('-m', '指定 stash 说明', { takesValue: true }),
                ],
                subcommands: [
                    command('push', '创建新的 stash'),
                    command('pop', '弹出最近的 stash'),
                    command('list', '查看 stash 列表'),
                    command('show', '查看 stash 内容'),
                    command('apply', '应用指定 stash'),
                    command('drop', '删除指定 stash'),
                    command('clear', '清空全部 stash'),
                    command('branch', '基于 stash 创建分支'),
                ],
            }),
            command('switch', '切换分支', {
                flags: [
                    flag('-c', '新建并切换分支'),
                    flag('-C', '强制新建并切换分支'),
                    flag('--detach', '以 detached HEAD 模式切换'),
                ],
            }),
            command('tag', '管理标签', {
                flags: [
                    flag('-a', '创建附注标签'),
                    flag('-d', '删除标签'),
                    flag('-l', '列出标签'),
                    flag('-m', '设置标签说明', { takesValue: true }),
                ],
            }),
            command('worktree', '管理附加工作树', {
                subcommands: [
                    command('add', '添加工作树'),
                    command('list', '列出工作树'),
                    command('remove', '移除工作树'),
                    command('prune', '清理工作树元数据'),
                ],
            }),
            command('cherry-pick', '挑选提交到当前分支', {
                flags: [
                    flag('-n', '应用但不自动提交'),
                    flag('--continue', '继续当前 cherry-pick'),
                    flag('--abort', '中止当前 cherry-pick'),
                    flag('--skip', '跳过当前提交'),
                ],
            }),
            command('blame', '查看行级提交归属', {
                flags: [
                    flag('-L', '限制行范围', { takesValue: true }),
                    flag('-C', '检测跨文件移动'),
                    flag('-M', '检测文件内移动'),
                    flag('--date', '指定日期格式', {
                        takesValue: true,
                        args: [argument('format', '日期格式', { suggestions: GIT_DATE_FORMAT_SUGGESTIONS })],
                    }),
                ],
            }),
        ],
    }),
    command('docker', 'Docker 容器管理命令', {
        flags: [
            flag('--context', '指定 Docker context', { takesValue: true }),
            flag('--config', '指定配置目录', { takesValue: true }),
            flag('-H', '指定 Docker daemon 地址', { takesValue: true }),
            flag('--host', '指定 Docker daemon 地址', { takesValue: true }),
            flag('--log-level', '设置日志级别', {
                takesValue: true,
                args: [argument('level', 'Docker 日志级别', { suggestions: DOCKER_LOG_LEVEL_SUGGESTIONS })],
            }),
        ],
        subcommands: [
            command('build', '构建镜像', {
                flags: [
                    flag('-t', '设置镜像标签', { takesValue: true }),
                    flag('-f', '指定 Dockerfile', { takesValue: true }),
                    flag('--build-arg', '设置构建变量', { takesValue: true }),
                    flag('--platform', '指定构建目标平台', {
                        takesValue: true,
                        args: [argument('platform', 'Docker 目标平台', { suggestions: DOCKER_PLATFORM_SUGGESTIONS })],
                    }),
                    flag('--no-cache', '禁用构建缓存'),
                    flag('--pull', '总是拉取最新基础镜像'),
                ],
            }),
            command('compose', '执行 Docker Compose 子命令', {
                flags: [
                    flag('-f', '指定 compose 文件', { takesValue: true }),
                    flag('-p', '指定项目名称', { takesValue: true }),
                    flag('--profile', '指定 profile', { takesValue: true }),
                    flag('--env-file', '指定环境变量文件', { takesValue: true }),
                ],
                subcommands: [
                    command('up', '启动服务', {
                        flags: [
                            flag('-d', '后台运行'),
                            flag('--build', '启动前先构建'),
                            flag('--force-recreate', '强制重建容器'),
                            flag('--remove-orphans', '移除孤立容器'),
                            flag('--scale', '调整服务副本数', {
                                takesValue: true,
                                args: [argument('service=count', '服务扩容表达式', { suggestions: DOCKER_SCALE_SUGGESTIONS })],
                            }),
                        ],
                    }),
                    command('down', '停止并移除服务', {
                        flags: [
                            flag('--volumes', '同时移除数据卷'),
                            flag('--remove-orphans', '移除孤立容器'),
                            flag('--rmi', '同时移除镜像', {
                                takesValue: true,
                                args: [argument('mode', '镜像移除范围', { suggestions: DOCKER_IMAGE_PRUNE_MODE_SUGGESTIONS })],
                            }),
                        ],
                    }),
                    command('build', '构建 compose 服务镜像', {
                        flags: [flag('--no-cache', '禁用构建缓存'), flag('--pull', '总是拉取基础镜像')],
                    }),
                    command('ps', '查看服务容器状态', {
                        flags: [
                            flag('-a', '显示所有容器'),
                            flag('--format', '指定输出格式', {
                                takesValue: true,
                                args: [argument('format', 'Compose 状态输出格式', { suggestions: DOCKER_FORMAT_SUGGESTIONS })],
                            }),
                            flag('--status', '按状态过滤', {
                                takesValue: true,
                                args: [argument('status', 'Compose 容器状态', { suggestions: DOCKER_STATUS_SUGGESTIONS })],
                            }),
                        ],
                    }),
                    command('logs', '查看服务日志', {
                        flags: [
                            flag('-f', '持续跟踪日志'),
                            flag('--tail', '限制尾部行数', { takesValue: true }),
                            flag('--timestamps', '显示时间戳'),
                        ],
                    }),
                    command('exec', '进入服务容器执行命令', {
                        flags: [
                            flag('-T', '禁用 TTY'),
                            flag('-u', '指定用户', { takesValue: true }),
                            flag('-e', '设置环境变量', { takesValue: true }),
                        ],
                    }),
                    command('run', '启动一次性服务容器', {
                        flags: [
                            flag('--rm', '退出后自动删除容器'),
                            flag('--service-ports', '暴露服务端口'),
                            flag('-T', '禁用 TTY'),
                        ],
                    }),
                    command('pull', '拉取 compose 服务镜像', {
                        flags: [flag('--include-deps', '同时拉取依赖服务镜像')],
                    }),
                    command('restart', '重启服务容器'),
                    command('stop', '停止服务容器', {
                        flags: [flag('--timeout', '停止超时时间', { takesValue: true })],
                    }),
                    command('start', '启动已创建的服务容器'),
                    command('config', '查看 compose 解析结果', {
                        flags: [
                            flag('--services', '仅输出服务名'),
                            flag('--volumes', '仅输出卷定义'),
                            flag('--images', '仅输出镜像名'),
                        ],
                    }),
                ],
            }),
            command('container', '管理容器对象', {
                subcommands: [
                    command('ls', '列出容器', {
                        aliases: ['ps'],
                        flags: [
                            flag('-a', '显示所有容器'),
                            flag('--format', '指定输出格式', {
                                takesValue: true,
                                args: [argument('format', '容器列表输出格式', { suggestions: DOCKER_FORMAT_SUGGESTIONS })],
                            }),
                        ],
                    }),
                    command('inspect', '查看容器详情'),
                    command('logs', '查看容器日志', {
                        flags: [
                            flag('-f', '持续跟踪日志'),
                            flag('--tail', '限制尾部行数', { takesValue: true }),
                        ],
                    }),
                    command('exec', '在容器内执行命令', {
                        flags: [
                            flag('-it', '分配交互式 TTY'),
                            flag('-u', '指定用户', { takesValue: true }),
                            flag('-e', '设置环境变量', { takesValue: true }),
                        ],
                    }),
                    command('start', '启动容器'),
                    command('stop', '停止容器'),
                    command('restart', '重启容器'),
                    command('rm', '删除容器', {
                        flags: [flag('-f', '强制删除'), flag('-v', '同时删除匿名卷')],
                    }),
                    command('prune', '清理已停止容器', {
                        flags: [flag('-f', '跳过确认')],
                    }),
                ],
            }),
            command('exec', '在运行中的容器内执行命令', {
                flags: [
                    flag('-it', '分配交互式 TTY'),
                    flag('-u', '指定用户', { takesValue: true }),
                    flag('-e', '设置环境变量', { takesValue: true }),
                ],
            }),
            command('image', '管理镜像对象', {
                subcommands: [
                    command('ls', '列出镜像', { aliases: ['images'] }),
                    command('build', '构建镜像', {
                        flags: [
                            flag('-t', '设置镜像标签', { takesValue: true }),
                            flag('-f', '指定 Dockerfile', { takesValue: true }),
                            flag('--no-cache', '禁用构建缓存'),
                        ],
                    }),
                    command('pull', '拉取镜像'),
                    command('push', '推送镜像'),
                    command('rm', '删除镜像', { flags: [flag('-f', '强制删除')] }),
                    command('inspect', '查看镜像详情'),
                    command('history', '查看镜像历史'),
                    command('prune', '清理未使用镜像', {
                        flags: [
                            flag('-a', '移除所有未使用镜像'),
                            flag('-f', '跳过确认'),
                        ],
                    }),
                    command('tag', '为镜像打标签'),
                ],
            }),
            command('images', '列出本地镜像'),
            command('inspect', '查看对象详情'),
            command('logs', '查看容器日志', {
                flags: [
                    flag('-f', '持续跟踪日志'),
                    flag('--tail', '限制尾部行数', { takesValue: true }),
                    flag('--timestamps', '显示时间戳'),
                ],
            }),
            command('network', '管理网络对象', {
                subcommands: [
                    command('ls', '列出网络'),
                    command('create', '创建网络', {
                        flags: [
                            flag('--driver', '指定网络驱动', {
                                takesValue: true,
                                args: [argument('driver', 'Docker 网络驱动', { suggestions: DOCKER_NETWORK_DRIVER_SUGGESTIONS })],
                            }),
                            flag('--subnet', '指定子网', { takesValue: true }),
                        ],
                    }),
                    command('rm', '删除网络'),
                    command('inspect', '查看网络详情'),
                    command('prune', '清理未使用网络', {
                        flags: [flag('-f', '跳过确认')],
                    }),
                ],
            }),
            command('ps', '列出容器', {
                flags: [
                    flag('-a', '显示所有容器'),
                    flag('--format', '指定输出格式', {
                        takesValue: true,
                        args: [argument('format', '容器列表输出格式', { suggestions: DOCKER_FORMAT_SUGGESTIONS })],
                    }),
                    flag('--filter', '按条件过滤', { takesValue: true }),
                ],
            }),
            command('pull', '拉取镜像'),
            command('push', '推送镜像'),
            command('restart', '重启容器'),
            command('rm', '删除容器', {
                flags: [flag('-f', '强制删除'), flag('-v', '同时删除匿名卷')],
            }),
            command('run', '创建并运行容器', {
                flags: [
                    flag('-d', '后台运行'),
                    flag('--rm', '退出后自动删除'),
                    flag('-p', '端口映射', {
                        takesValue: true,
                        args: [argument('mapping', '端口映射表达式', { suggestions: DOCKER_PORT_MAPPING_SUGGESTIONS })],
                    }),
                    flag('-e', '设置环境变量', { takesValue: true }),
                    flag('-v', '挂载卷', {
                        takesValue: true,
                        args: [argument('volume', '卷挂载表达式', { suggestions: DOCKER_VOLUME_MAPPING_SUGGESTIONS })],
                    }),
                    flag('--name', '指定容器名称', { takesValue: true }),
                    flag('--network', '指定网络', {
                        takesValue: true,
                        args: [argument('network', '容器网络模式', { suggestions: DOCKER_RUN_NETWORK_SUGGESTIONS })],
                    }),
                    flag('-it', '分配交互式 TTY'),
                ],
            }),
            command('start', '启动容器'),
            command('stop', '停止容器', {
                flags: [flag('--time', '停止超时时间', { takesValue: true })],
            }),
            command('system', '查看或清理系统资源', {
                subcommands: [
                    command('df', '查看磁盘占用'),
                    command('events', '查看 Docker 事件流'),
                    command('info', '查看 Docker 环境信息'),
                    command('prune', '清理未使用对象', {
                        flags: [
                            flag('-a', '清理所有未使用镜像'),
                            flag('--volumes', '同时清理未使用卷'),
                            flag('-f', '跳过确认'),
                        ],
                    }),
                ],
            }),
            command('tag', '为镜像打标签'),
            command('volume', '管理卷对象', {
                subcommands: [
                    command('ls', '列出卷'),
                    command('create', '创建卷'),
                    command('rm', '删除卷'),
                    command('inspect', '查看卷详情'),
                    command('prune', '清理未使用卷', {
                        flags: [flag('-f', '跳过确认')],
                    }),
                ],
            }),
        ],
    }),
    command('kubectl', 'Kubernetes 集群管理命令', {
        flags: [
            flag('-n', '指定命名空间', { aliases: ['--namespace'], takesValue: true }),
            flag('-A', '跨全部命名空间操作', { aliases: ['--all-namespaces'] }),
            flag('-o', '指定输出格式', {
                aliases: ['--output'],
                takesValue: true,
                args: [argument('format', 'kubectl 输出格式', { suggestions: KUBECTL_OUTPUT_SUGGESTIONS })],
            }),
            flag('--context', '指定 kube context', { takesValue: true }),
            flag('--kubeconfig', '指定 kubeconfig 文件', { takesValue: true }),
            flag('-f', '指定资源文件', { aliases: ['--filename'], takesValue: true }),
            flag('-l', '按标签过滤', { aliases: ['--selector'], takesValue: true }),
            flag('--field-selector', '按字段过滤', { takesValue: true }),
        ],
        subcommands: [
            command('apply', '应用资源清单', {
                flags: [
                    flag('-f', '指定资源文件', { takesValue: true }),
                    flag('-k', '指定 kustomization 目录', { takesValue: true }),
                    flag('--server-side', '使用服务端 apply'),
                    flag('--dry-run', '试运行模式', {
                        takesValue: true,
                        args: [argument('mode', 'dry-run 模式', { suggestions: KUBECTL_DRY_RUN_SUGGESTIONS })],
                    }),
                    flag('--prune', '清理未在清单中的资源'),
                ],
            }),
            command('auth', '认证与权限相关命令', {
                subcommands: [
                    command('can-i', '检查当前身份是否具备指定权限', {
                        args: [
                            argument('verb', '资源操作动词', { suggestions: KUBECTL_AUTH_VERB_SUGGESTIONS }),
                            argument('resource', '资源类型', { suggestions: KUBERNETES_RESOURCE_SUGGESTIONS }),
                        ],
                    }),
                ],
            }),
            command('cluster-info', '查看集群信息'),
            command('config', '管理 kubeconfig', {
                subcommands: [
                    command('current-context', '查看当前 context'),
                    command('get-contexts', '列出可用 contexts'),
                    command('use-context', '切换 context'),
                    command('set-context', '设置 context'),
                    command('view', '查看 kubeconfig 内容'),
                    command('delete-context', '删除 context'),
                    command('rename-context', '重命名 context'),
                ],
            }),
            command('cp', '在本地与 Pod 之间复制文件', {
                flags: [
                    flag('-c', '指定容器', { takesValue: true }),
                    flag('--no-preserve', '不保留文件属性'),
                ],
            }),
            command('create', '创建资源对象', {
                subcommands: [
                    command('namespace', '创建命名空间'),
                    command('configmap', '创建 ConfigMap', {
                        flags: [
                            flag('--from-file', '从文件加载键值', { takesValue: true }),
                            flag('--from-literal', '从字面量创建键值', { takesValue: true }),
                        ],
                    }),
                    command('secret', '创建 Secret', {
                        subcommands: [
                            command('generic', '创建通用 Secret', {
                                flags: [
                                    flag('--from-file', '从文件创建 Secret', { takesValue: true }),
                                    flag('--from-literal', '从字面量创建 Secret', { takesValue: true }),
                                ],
                            }),
                            command('docker-registry', '创建镜像仓库认证 Secret'),
                            command('tls', '创建 TLS Secret'),
                        ],
                    }),
                    command('deployment', '创建 Deployment', {
                        flags: [
                            flag('--image', '指定镜像', { takesValue: true }),
                            flag('--replicas', '指定副本数', { takesValue: true }),
                            flag('--port', '指定容器端口', { takesValue: true }),
                        ],
                    }),
                    command('job', '创建 Job'),
                    command('cronjob', '创建 CronJob'),
                    command('service', '创建 Service'),
                    command('serviceaccount', '创建 ServiceAccount'),
                    command('ingress', '创建 Ingress'),
                ],
            }),
            command('delete', '删除资源对象', {
                flags: [
                    flag('-f', '指定资源文件', { takesValue: true }),
                    flag('-k', '指定 kustomization 目录', { takesValue: true }),
                    flag('--force', '强制删除'),
                    flag('--grace-period', '优雅退出秒数', { takesValue: true }),
                    flag('--wait', '等待删除完成'),
                ],
                subcommands: KUBERNETES_RESOURCE_COMMANDS,
            }),
            command('describe', '查看资源详情', { subcommands: KUBERNETES_RESOURCE_COMMANDS }),
            command('edit', '编辑资源对象', { subcommands: KUBERNETES_RESOURCE_COMMANDS }),
            command('exec', '进入容器执行命令', {
                flags: [
                    flag('-i', '保持标准输入开启'),
                    flag('-t', '分配 TTY'),
                    flag('-it', '交互式 TTY'),
                    flag('-c', '指定容器', { takesValue: true }),
                ],
            }),
            command('expose', '为资源创建 Service', {
                flags: [
                    flag('--port', '暴露端口', { takesValue: true }),
                    flag('--target-port', '目标端口', { takesValue: true }),
                    flag('--type', 'Service 类型', {
                        takesValue: true,
                        args: [argument('type', 'Kubernetes Service 类型', { suggestions: KUBECTL_SERVICE_TYPE_SUGGESTIONS })],
                    }),
                ],
            }),
            command('get', '查询资源列表', {
                flags: [
                    flag('-o', '指定输出格式', { aliases: ['--output'], takesValue: true }),
                    flag('-w', '持续监听变更'),
                    flag('--show-labels', '输出标签列'),
                    flag('--sort-by', '按 JSONPath 排序', { takesValue: true }),
                    flag('--field-selector', '按字段过滤', { takesValue: true }),
                ],
                subcommands: KUBERNETES_RESOURCE_COMMANDS,
            }),
            command('logs', '查看 Pod 日志', {
                flags: [
                    flag('-f', '持续跟踪日志'),
                    flag('--tail', '限制尾部行数', { takesValue: true }),
                    flag('-c', '指定容器', { takesValue: true }),
                    flag('--previous', '查看前一个容器日志'),
                ],
            }),
            command('port-forward', '建立端口转发', {
                flags: [flag('--address', '监听地址', { takesValue: true })],
            }),
            command('rollout', '管理资源发布过程', {
                subcommands: [
                    command('restart', '重启资源'),
                    command('status', '查看发布状态', {
                        flags: [flag('--watch', '持续监听状态')],
                    }),
                    command('history', '查看发布历史'),
                    command('undo', '回滚到上一个版本', {
                        flags: [flag('--to-revision', '指定目标版本', { takesValue: true })],
                    }),
                ],
            }),
            command('scale', '调整资源副本数', {
                flags: [flag('--replicas', '设置副本数量', { takesValue: true })],
                subcommands: [
                    command('deployments', '调整 Deployment 副本数', { aliases: ['deploy'] }),
                    command('statefulsets', '调整 StatefulSet 副本数', { aliases: ['sts'] }),
                    command('replicasets', '调整 ReplicaSet 副本数', { aliases: ['rs'] }),
                ],
            }),
            command('set', '批量更新资源配置', {
                subcommands: [
                    command('image', '更新容器镜像'),
                    command('resources', '更新资源限制'),
                    command('env', '更新环境变量'),
                ],
            }),
            command('top', '查看资源监控指标', {
                subcommands: [
                    command('pod', '查看 Pod 资源使用'),
                    command('node', '查看 Node 资源使用'),
                ],
            }),
            command('wait', '等待资源达到指定状态', {
                flags: [
                    flag('--for', '指定等待条件', {
                        takesValue: true,
                        args: [argument('condition', '等待条件', { suggestions: KUBECTL_WAIT_CONDITION_SUGGESTIONS })],
                    }),
                    flag('--timeout', '设置超时时间', {
                        takesValue: true,
                        args: [argument('duration', '等待超时时间', { suggestions: KUBECTL_TIMEOUT_SUGGESTIONS })],
                    }),
                ],
                subcommands: KUBERNETES_RESOURCE_COMMANDS,
            }),
        ],
    }),
    command('systemctl', 'systemd 服务管理命令', {
        flags: [
            flag('--user', '操作用户级服务'),
            flag('--system', '操作系统级服务'),
            flag('--now', '启用或禁用后立即生效'),
            flag('--no-pager', '禁用分页显示'),
            flag('-H', '通过远端主机执行', { takesValue: true }),
            flag('-o', '指定输出格式', {
                aliases: ['--output'],
                takesValue: true,
                args: [argument('format', 'systemctl 输出格式', { suggestions: SYSTEMD_OUTPUT_SUGGESTIONS })],
            }),
        ],
        subcommands: [
            command('start', '启动服务'),
            command('stop', '停止服务'),
            command('restart', '重启服务'),
            command('reload', '重载服务配置'),
            command('reload-or-restart', '优先重载，否则重启'),
            command('status', '查看服务状态'),
            command('enable', '设置开机启动'),
            command('disable', '取消开机启动'),
            command('mask', '屏蔽服务'),
            command('unmask', '取消屏蔽服务'),
            command('is-active', '检查服务是否激活'),
            command('is-enabled', '检查服务是否启用'),
            command('list-units', '列出当前单元', {
                flags: [
                    flag('--type', '按单元类型过滤', {
                        takesValue: true,
                        args: [argument('type', 'systemd 单元类型', { suggestions: SYSTEMD_UNIT_TYPE_SUGGESTIONS })],
                    }),
                    flag('--state', '按状态过滤', {
                        takesValue: true,
                        args: [argument('state', 'systemd 单元状态', { suggestions: SYSTEMD_UNIT_STATE_SUGGESTIONS })],
                    }),
                    flag('--all', '显示全部单元'),
                ],
            }),
            command('list-unit-files', '列出已安装单元文件', {
                flags: [
                    flag('--type', '按单元类型过滤', {
                        takesValue: true,
                        args: [argument('type', 'systemd 单元类型', { suggestions: SYSTEMD_UNIT_TYPE_SUGGESTIONS })],
                    }),
                    flag('--state', '按状态过滤', {
                        takesValue: true,
                        args: [argument('state', 'systemd 单元文件状态', { suggestions: SYSTEMD_UNIT_FILE_STATE_SUGGESTIONS })],
                    }),
                ],
            }),
            command('daemon-reload', '重新加载 systemd 配置'),
            command('cat', '查看单元文件内容'),
            command('show', '查看详细属性'),
            command('edit', '编辑或覆盖单元配置'),
        ],
    }),
    command('ssh', '建立 SSH 远端连接', {
        flags: [
            flag('-p', '指定远端端口', { takesValue: true }),
            flag('-i', '指定私钥文件', { takesValue: true }),
            flag('-o', '设置 SSH 选项', {
                takesValue: true,
                args: [argument('option', 'SSH 选项赋值', { suggestions: SSH_OPTION_SUGGESTIONS })],
            }),
            flag('-L', '本地端口转发', {
                takesValue: true,
                args: [argument('forward', '本地端口转发表达式', { suggestions: SSH_LOCAL_FORWARD_SUGGESTIONS })],
            }),
            flag('-R', '远端端口转发', {
                takesValue: true,
                args: [argument('forward', '远端端口转发表达式', { suggestions: SSH_REMOTE_FORWARD_SUGGESTIONS })],
            }),
            flag('-D', '动态端口转发', {
                takesValue: true,
                args: [argument('forward', '动态代理监听地址', { suggestions: SSH_DYNAMIC_FORWARD_SUGGESTIONS })],
            }),
            flag('-J', '指定跳板机', { takesValue: true }),
            flag('-l', '指定用户名', { takesValue: true }),
            flag('-tt', '强制分配伪终端'),
            flag('-T', '禁用伪终端'),
            flag('-N', '不执行远端命令'),
            flag('-f', '后台运行'),
            flag('-A', '启用代理转发'),
            flag('-v', '详细输出'),
            flag('-X', '启用 X11 转发'),
            flag('-Y', '启用可信任 X11 转发'),
        ],
    }),
    command('scp', '通过 SSH 复制文件', {
        flags: [
            flag('-r', '递归复制目录'),
            flag('-P', '指定远端端口', { takesValue: true }),
            flag('-i', '指定私钥文件', { takesValue: true }),
            flag('-o', '设置 SSH 选项', {
                takesValue: true,
                args: [argument('option', 'SSH 选项赋值', { suggestions: SSH_OPTION_SUGGESTIONS })],
            }),
            flag('-p', '保留时间戳和权限'),
            flag('-C', '启用压缩'),
            flag('-q', '静默模式'),
        ],
    }),
    command('rsync', '同步文件与目录', {
        flags: [
            flag('-a', '归档模式同步'),
            flag('-v', '显示详细输出'),
            flag('-z', '传输时压缩'),
            flag('--delete', '删除目标端多余文件'),
            flag('--progress', '显示进度信息'),
            flag('--exclude', '排除匹配路径', { takesValue: true }),
            flag('--include', '包含匹配路径', { takesValue: true }),
            flag('-e', '指定远端 shell', { takesValue: true }),
            flag('--dry-run', '预演同步结果'),
        ],
    }),
    command('curl', '发起 HTTP 请求', {
        flags: [
            flag('-X', '指定请求方法', {
                takesValue: true,
                args: [argument('method', 'HTTP 请求方法', { suggestions: CURL_METHOD_SUGGESTIONS })],
            }),
            flag('-H', '追加请求头', {
                takesValue: true,
                insertText: '-H "${1:Header}: ${2:value}"',
                insertAsSnippet: true,
                args: [argument('header', 'HTTP 请求头', { suggestions: CURL_HEADER_SUGGESTIONS })],
            }),
            flag('-d', '发送请求体数据', {
                takesValue: true,
                insertText: '-d "${1:key}=${2:value}"',
                insertAsSnippet: true,
            }),
            flag('-F', '上传表单字段', {
                takesValue: true,
                args: [argument('field', 'multipart 表单字段', { suggestions: CURL_FORM_SUGGESTIONS })],
            }),
            flag('-L', '跟随重定向'),
            flag('-s', '静默模式'),
            flag('-S', '静默模式下仍显示错误'),
            flag('-o', '输出到文件', { takesValue: true }),
            flag('-O', '使用远端文件名保存'),
            flag('-I', '仅请求响应头'),
            flag('--connect-timeout', '设置连接超时', { takesValue: true }),
            flag('--retry', '设置重试次数', { takesValue: true }),
            flag('--retry-all-errors', '全部错误都重试'),
            flag('-u', '设置 HTTP 认证信息', {
                takesValue: true,
                args: [argument('credential', 'HTTP Basic 认证凭据', { suggestions: CURL_AUTH_SUGGESTIONS })],
            }),
            flag('-k', '忽略 TLS 证书校验'),
            flag('--compressed', '请求压缩响应'),
            flag('--fail', 'HTTP 错误时返回非零退出码'),
            flag('--fail-with-body', 'HTTP 错误时仍输出响应体'),
        ],
    }),
    command('tar', '打包或解压归档文件', {
        flags: [
            flag('-c', '创建归档文件'),
            flag('-x', '解压归档文件'),
            flag('-t', '列出归档内容'),
            flag('-f', '指定归档文件路径', { takesValue: true }),
            flag('-v', '显示详细过程'),
            flag('-z', '使用 gzip 压缩'),
            flag('-j', '使用 bzip2 压缩'),
            flag('-J', '使用 xz 压缩'),
            flag('-C', '切换到目标目录再执行', { takesValue: true }),
            flag('--exclude', '排除匹配路径', { takesValue: true }),
        ],
    }),
    command('journalctl', '查看 systemd 日志', {
        flags: [
            flag('-u', '按服务过滤日志', { takesValue: true }),
            flag('-f', '持续跟踪日志'),
            flag('-n', '限制显示行数', { takesValue: true }),
            flag('-b', '查看当前启动周期日志'),
            flag('-k', '仅显示内核日志'),
            flag('-p', '按优先级过滤', {
                takesValue: true,
                args: [argument('priority', '日志优先级', { suggestions: JOURNAL_PRIORITY_SUGGESTIONS })],
            }),
            flag('-o', '指定日志输出格式', {
                aliases: ['--output'],
                takesValue: true,
                args: [argument('format', 'journalctl 输出格式', { suggestions: JOURNAL_OUTPUT_SUGGESTIONS })],
            }),
            flag('--since', '设置起始时间', {
                takesValue: true,
                args: [argument('time', '起始时间表达式', { suggestions: JOURNAL_TIME_SUGGESTIONS })],
            }),
            flag('--until', '设置结束时间', {
                takesValue: true,
                args: [argument('time', '结束时间表达式', { suggestions: JOURNAL_TIME_SUGGESTIONS })],
            }),
            flag('--no-pager', '禁用分页显示'),
        ],
    }),
    command('find', '递归查找文件或目录', {
        flags: [
            flag('-name', '按名称匹配', { takesValue: true }),
            flag('-iname', '按名称匹配并忽略大小写', { takesValue: true }),
            flag('-type', '按类型过滤', {
                takesValue: true,
                args: [argument('type', 'find 文件类型', { suggestions: FIND_TYPE_SUGGESTIONS })],
            }),
            flag('-maxdepth', '限制最大深度', { takesValue: true }),
            flag('-mindepth', '限制最小深度', { takesValue: true }),
            flag('-print', '打印匹配结果'),
            flag('-exec', '对结果执行命令', { takesValue: true }),
            flag('-mtime', '按修改时间过滤', { takesValue: true }),
            flag('-size', '按文件大小过滤', { takesValue: true }),
            flag('-not', '逻辑非过滤'),
            flag('-path', '按路径匹配', { takesValue: true }),
        ],
    }),
    command('grep', '在文本中搜索内容', {
        flags: [
            flag('-i', '忽略大小写'),
            flag('-n', '显示匹配行号'),
            flag('-r', '递归搜索'),
            flag('-R', '递归跟随符号链接'),
            flag('-v', '输出不匹配的行'),
            flag('-E', '使用扩展正则'),
            flag('-F', '按固定字符串匹配'),
            flag('-P', '使用 Perl 正则'),
            flag('-C', '显示上下文行数', { takesValue: true }),
            flag('-A', '显示后续行数', { takesValue: true }),
            flag('-B', '显示前置行数', { takesValue: true }),
            flag('--color=auto', '高亮匹配结果'),
            flag('--line-buffered', '逐行刷新输出'),
        ],
    }),
    command('sed', '流式编辑文本', {
        flags: [
            flag('-n', '静默模式，仅输出明确打印内容'),
            flag('-e', '追加编辑表达式', { takesValue: true }),
            flag('-f', '从文件读取表达式', { takesValue: true }),
            flag('-i', '原地修改文件', { takesValue: true }),
            flag('-E', '启用扩展正则'),
            flag('-r', '启用扩展正则'),
        ],
    }),
    command('awk', '按字段处理文本流', {
        flags: [
            flag('-F', '指定字段分隔符', {
                takesValue: true,
                args: [argument('separator', '字段分隔符', { suggestions: AWK_FIELD_SEPARATOR_SUGGESTIONS })],
            }),
            flag('-v', '设置变量', {
                takesValue: true,
                args: [argument('assignment', '变量赋值表达式', { suggestions: AWK_VARIABLE_ASSIGNMENT_SUGGESTIONS })],
            }),
            flag('-f', '从文件读取程序', { takesValue: true }),
        ],
    }),
    command('npm', 'Node.js 默认包管理器', {
        flags: [
            flag('--prefix', '指定项目目录', { takesValue: true }),
            flag('--workspace', '指定工作区', { takesValue: true }),
            flag('--help', '查看帮助信息'),
        ],
        subcommands: [
            command('ci', '按 lockfile 全量安装依赖'),
            ...PACKAGE_MANAGER_COMMANDS,
        ],
    }),
    command('pnpm', '高性能 Node.js 包管理器', {
        flags: [
            flag('--dir', '指定项目目录', { takesValue: true }),
            flag('--workspace-root', '作用于工作区根目录'),
            flag('--filter', '按包过滤执行范围', { takesValue: true }),
        ],
        subcommands: [
            command('dlx', '临时执行 npm 包'),
            command('why', '查看依赖来源'),
            ...PACKAGE_MANAGER_COMMANDS,
        ],
    }),
    command('yarn', 'Yarn 包管理器', {
        flags: [
            flag('--cwd', '指定项目目录', { takesValue: true }),
            flag('--help', '查看帮助信息'),
        ],
        subcommands: [
            command('dlx', '临时执行 npm 包'),
            command('workspace', '在指定工作区执行命令'),
            command('workspaces', '管理多工作区', {
                subcommands: [
                    command('list', '列出工作区'),
                    command('foreach', '遍历执行工作区脚本'),
                ],
            }),
            command('npm', '执行 npm registry 相关命令', {
                subcommands: [
                    command('publish', '发布包到 registry'),
                    command('login', '登录 registry'),
                    command('logout', '退出登录'),
                ],
            }),
            ...PACKAGE_MANAGER_COMMANDS,
        ],
    }),
    command('cargo', 'Rust 包与构建管理器', {
        flags: [
            flag('--manifest-path', '指定 Cargo.toml 路径', { takesValue: true }),
            flag('--locked', '严格使用 lockfile'),
            flag('--offline', '离线模式'),
            flag('--help', '查看帮助信息'),
        ],
        subcommands: [
            command('build', '构建项目', {
                flags: [
                    flag('--release', '构建 release 版本'),
                    flag('--target', '指定编译目标', {
                        takesValue: true,
                        args: [argument('target', 'Rust 目标三元组', { suggestions: CARGO_TARGET_SUGGESTIONS })],
                    }),
                    flag('--features', '启用 features', { takesValue: true }),
                ],
            }),
            command('run', '编译并运行项目', {
                flags: [
                    flag('--release', '运行 release 版本'),
                    flag('--bin', '指定二进制目标', { takesValue: true }),
                    flag('--package', '指定包名', { takesValue: true }),
                    flag('--target', '指定编译目标', {
                        takesValue: true,
                        args: [argument('target', 'Rust 目标三元组', { suggestions: CARGO_TARGET_SUGGESTIONS })],
                    }),
                ],
            }),
            command('test', '运行测试', {
                flags: [
                    flag('--release', '以 release 模式测试'),
                    flag('--package', '指定包名', { takesValue: true }),
                    flag('--features', '启用 features', { takesValue: true }),
                    flag('--target', '指定编译目标', {
                        takesValue: true,
                        args: [argument('target', 'Rust 目标三元组', { suggestions: CARGO_TARGET_SUGGESTIONS })],
                    }),
                ],
            }),
            command('check', '快速检查代码'),
            command('clippy', '运行 Clippy 静态检查', {
                flags: [flag('--fix', '自动修复部分问题')],
            }),
            command('fmt', '运行 rustfmt 格式化', {
                flags: [flag('--check', '只检查不修改')],
            }),
            command('add', '添加依赖包'),
            command('install', '安装可执行 crate'),
            command('update', '更新依赖'),
            command('clean', '清理构建产物'),
            command('doc', '生成文档', {
                flags: [flag('--open', '生成后直接打开文档')],
            }),
            command('tree', '查看依赖树', {
                flags: [
                    flag('-e', '指定边类型', {
                        takesValue: true,
                        args: [argument('edge', 'Cargo 依赖边类型', { suggestions: CARGO_TREE_EDGE_SUGGESTIONS })],
                    }),
                ],
            }),
            command('bench', '运行 benchmark'),
        ],
    }),
    command('python', 'Python 解释器', {
        flags: [
            flag('-m', '以模块方式运行', { takesValue: true }),
            flag('-c', '执行命令字符串', { takesValue: true }),
            flag('-V', '查看 Python 版本'),
            flag('-u', '禁用输出缓冲'),
            flag('-O', '启用优化模式'),
            flag('-W', '设置 warning 过滤规则', {
                takesValue: true,
                args: [argument('action', 'Python warning 处理策略', { suggestions: PYTHON_WARNING_SUGGESTIONS })],
            }),
        ],
    }),
    command('pip', 'Python 包管理器', {
        flags: [
            flag('--python', '指定目标 Python 解释器', { takesValue: true }),
            flag('--require-virtualenv', '要求在虚拟环境中运行'),
        ],
        subcommands: [
            command('install', '安装 Python 包', {
                flags: [
                    flag('-r', '从 requirements 文件安装', { takesValue: true }),
                    flag('-U', '升级已安装包'),
                    flag('--upgrade', '升级已安装包'),
                    flag('--index-url', '指定索引源', { takesValue: true }),
                    flag('--extra-index-url', '追加索引源', { takesValue: true }),
                    flag('--no-cache-dir', '禁用缓存'),
                ],
            }),
            command('uninstall', '卸载 Python 包', {
                flags: [flag('-y', '自动确认卸载')],
            }),
            command('list', '列出已安装包', {
                flags: [
                    flag('--outdated', '仅显示过期包'),
                    flag('--format', '指定输出格式', {
                        takesValue: true,
                        args: [argument('format', 'pip 列表输出格式', { suggestions: PIP_LIST_FORMAT_SUGGESTIONS })],
                    }),
                ],
            }),
            command('show', '查看包详情'),
            command('freeze', '导出已安装依赖'),
            command('download', '下载包文件', {
                flags: [flag('-d', '指定下载目录', { takesValue: true })],
            }),
            command('wheel', '构建 wheel 包', {
                flags: [flag('-w', '指定输出目录', { takesValue: true })],
            }),
            command('cache', '管理 pip 缓存', {
                subcommands: [
                    command('dir', '查看缓存目录'),
                    command('list', '列出缓存条目'),
                    command('purge', '清空缓存'),
                    command('remove', '删除指定缓存项'),
                ],
            }),
            command('config', '管理 pip 配置', {
                subcommands: [
                    command('list', '查看配置'),
                    command('get', '读取配置项'),
                    command('set', '设置配置项'),
                    command('unset', '删除配置项'),
                ],
            }),
            command('index', '查询包索引', {
                subcommands: [command('versions', '查看可用版本')],
            }),
        ],
    }),
    command('uv', 'Python 依赖与环境管理工具', {
        flags: [
            flag('--project', '指定项目目录', { takesValue: true }),
            flag('--python', '指定 Python 解释器', { takesValue: true }),
            flag('--offline', '离线模式'),
        ],
        subcommands: [
            command('run', '在项目环境中运行命令'),
            command('sync', '同步依赖到虚拟环境'),
            command('add', '添加依赖'),
            command('remove', '移除依赖'),
            command('lock', '刷新锁文件'),
            command('tree', '查看依赖树'),
            command('venv', '创建虚拟环境', {
                flags: [flag('--python', '指定 Python 版本', { takesValue: true })],
            }),
            command('pip', '兼容 pip 的子命令', {
                subcommands: [
                    command('install', '安装依赖包'),
                    command('uninstall', '卸载依赖包'),
                    command('compile', '生成 requirements 锁定文件'),
                    command('sync', '按锁文件同步环境'),
                ],
            }),
            command('python', '管理 Python 版本', {
                subcommands: [
                    command('list', '列出可用 Python 版本'),
                    command('install', '安装 Python 版本'),
                    command('pin', '固定项目使用的 Python 版本'),
                ],
            }),
        ],
    }),
    command('helm', 'Kubernetes 应用包管理器', {
        flags: [
            flag('-n', '指定命名空间', { aliases: ['--namespace'], takesValue: true }),
            flag('-f', '指定 values 文件', { aliases: ['--values'], takesValue: true }),
            flag('--kube-context', '指定 kube context', { takesValue: true }),
        ],
        subcommands: [
            command('install', '安装 Helm Release', {
                flags: [
                    flag('--create-namespace', '自动创建命名空间'),
                    flag('--set', '覆盖 values 项', { takesValue: true }),
                    flag('--wait', '等待资源就绪'),
                    flag('--version', '指定 chart 版本', { takesValue: true }),
                ],
            }),
            command('upgrade', '升级 Helm Release', {
                flags: [
                    flag('--install', '不存在时自动安装'),
                    flag('--reuse-values', '复用现有 values'),
                    flag('--set', '覆盖 values 项', { takesValue: true }),
                    flag('--wait', '等待资源就绪'),
                ],
            }),
            command('uninstall', '卸载 Helm Release'),
            command('list', '列出已安装 Release', {
                flags: [
                    flag('-A', '跨全部命名空间显示'),
                    flag('--all-namespaces', '跨全部命名空间显示'),
                ],
            }),
            command('status', '查看 Release 状态'),
            command('template', '渲染模板但不安装', {
                flags: [
                    flag('--set', '覆盖 values 项', { takesValue: true }),
                    flag('--values', '指定 values 文件', { takesValue: true }),
                ],
            }),
            command('repo', '管理 chart 仓库', {
                subcommands: [
                    command('add', '添加 chart 仓库'),
                    command('remove', '移除 chart 仓库'),
                    command('update', '更新仓库索引'),
                    command('list', '列出 chart 仓库'),
                ],
            }),
            command('search', '搜索 chart', {
                subcommands: [
                    command('repo', '在仓库中搜索 chart'),
                    command('hub', '在 Hub 中搜索 chart'),
                ],
            }),
            command('dependency', '管理 chart 依赖', {
                subcommands: [
                    command('build', '构建依赖'),
                    command('update', '更新依赖'),
                    command('list', '列出依赖'),
                ],
            }),
            command('package', '打包 chart'),
            command('pull', '拉取 chart 包'),
            command('get', '获取 Release 详情', {
                subcommands: [
                    command('values', '查看 Release values'),
                    command('manifest', '查看渲染后的 manifest'),
                    command('all', '查看全部信息'),
                ],
            }),
        ],
    }),
];