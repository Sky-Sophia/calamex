// fix-ssh-mustache.cjs
// 用法：在仓库根目录执行  node fix-ssh-mustache.cjs
// 作用：给 SshSidebarPanel.vue 漏掉的 Vue 插值补花括号（21 处 / 22 次替换）
const fs = require('node:fs');

const file =
    process.argv[2] ||
    'src/components/workbench/SshSidebarPanel.vue';

const O = '\u007b\u007b'; // 左双花括号
const C = '\u007d\u007d'; // 右双花括号
function w(e) {
    return O + ' ' + e + ' ' + C;
}

// 顺序有意义：先替换带标签的 ssh-file-name，再处理传输区裸 item.name
const repls = [
    // 文件列表（带标签精确匹配，避开 aria-label 里的 ${item.name}）
    [`<span class="ssh-file-name"> item.name </span>`, '<span class="ssh-file-name">' + w('item.name') + '</span>'],
    [` item.name `, ' ' + w('item.name') + ' '], // 传输区任务名（此时仅剩这一处裸文本）
    [`<span class="ssh-file-meta"> item.metaLabel </span>`, '<span class="ssh-file-meta">' + w('item.metaLabel') + '</span>'],
    [`<span class="ssh-transfer-meta"> item.sizeLabel </span>`, '<span class="ssh-transfer-meta">' + w('item.sizeLabel') + '</span>'],
    [`<span class="ssh-transfer-meta"> item.progressLabel </span>`, '<span class="ssh-transfer-meta">' + w('item.progressLabel') + '</span>'],

    // 连接表单
    [`option.label`, w(`option.label`)],
    [`isConnecting ? '连接中…' : '连接'`, w(`isConnecting ? '连接中…' : '连接'`)],
    [`connectionErrorText || connectionStatusText`, w(`connectionErrorText || connectionStatusText`)],

    // 最近使用
    [`connection.username  @  connection.host`, w('connection.username') + ' @ ' + w('connection.host')],
    [`connection.lastUsedLabel`, w(`connection.lastUsedLabel`)],

    // 面包屑
    [`segment.label`, w(`segment.label`)],
    [`item.label`, w(`item.label`)], // 当前段 + 可点击段，两处

    // 传输列表
    [`item.direction === 'upload' ? '↑ 上传' : '↓ 下载'`, w(`item.direction === 'upload' ? '↑ 上传' : '↓ 下载'`)],
    [`item.status === 'done' ? '完成' : item.status === 'failed' ? '失败' : '进行中'`, w(`item.status === 'done' ? '完成' : item.status === 'failed' ? '失败' : '进行中'`)],

    // 三个弹窗
    [`“ currentRemotePath ”`, '“' + w('currentRemotePath') + '”'],
    [`“ pendingRenameItem.name ”`, '“' + w('pendingRenameItem.name') + '”'],
    [`“ pendingDeleteItem.name ”`, '“' + w('pendingDeleteItem.name') + '”'],
    [`isPathMutating ? '处理中…' : '创建'`, w(`isPathMutating ? '处理中…' : '创建'`)],
    [`isPathMutating ? '处理中…' : '重命名'`, w(`isPathMutating ? '处理中…' : '重命名'`)],
    [`isPathMutating ? '删除中…' : '删除'`, w(`isPathMutating ? '删除中…' : '删除'`)],
];

if (!fs.existsSync(file)) {
    console.error('找不到文件：' + file);
    process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
let total = 0;

for (const pair of repls) {
    const find = pair[0];
    const rep = pair[1];
    const count = src.split(find).length - 1;
    if (count === 0) {
        console.log('跳过(0)  ' + find.slice(0, 46));
        continue;
    }
    src = src.split(find).join(rep);
    total += count;
    console.log('替换(' + count + ')  ' + find.slice(0, 46));
}

if (total === 0) {
    console.log('\n没有可替换的内容（可能已修过），未改动文件。');
    process.exit(0);
}

fs.copyFileSync(file, file + '.bak');
fs.writeFileSync(file, src, 'utf8');
console.log('\n完成：共替换 ' + total + ' 次（预期 22），已备份到 ' + file + '.bak');