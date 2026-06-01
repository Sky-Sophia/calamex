// scripts/apply-ssh-fixes.cjs
// 一次性修复 SSH 相关问题 F1/F2/F3/F5/F6。执行完可删除本文件。
const fs = require('fs');
const path = require('path');

function replaceOnce(content, find, replace, label) {
    const count = content.split(find).length - 1;
    if (count !== 1) {
        throw new Error(`[${label}] 期望精确匹配 1 处，实际匹配到 ${count} 处，已中止以免误改。`);
    }
    return content.split(find).join(replace);
}

const edits = [
    // ── tauri.ts · F5：SSH 入参指标脱敏，避免序列化明文密码 ──────────────
    {
        file: 'src/services/tauri.ts',
        label: 'F5 helper',
        find: `const measureAiInlineCompletionInput = <T extends Record<string, unknown>>(
  value: T,
): IPayloadMetrics =>
  buildPayloadMetricsOmittingTextFields(value, ['prefix', 'suffix', 'recentEdits']);`,
        replace: `const measureAiInlineCompletionInput = <T extends Record<string, unknown>>(
  value: T,
): IPayloadMetrics =>
  buildPayloadMetricsOmittingTextFields(value, ['prefix', 'suffix', 'recentEdits']);

const measureSshSecretInput = <T extends Record<string, unknown>>(value: T): IPayloadMetrics =>
  buildPayloadMetricsOmittingTextFields(value, ['password']);`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 test_ssh_connection',
        find: `  tauriContracts.testSshConnection,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },`,
        replace: `  tauriContracts.testSshConnection,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive', measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 save_ssh_password',
        find: `  tauriContracts.saveSshPassword,
  { audit: 'sensitive' },`,
        replace: `  tauriContracts.saveSshPassword,
  { audit: 'sensitive', measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 list_ssh_directory',
        find: `  tauriContracts.listSshDirectory,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },`,
        replace: `  tauriContracts.listSshDirectory,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive', measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 download_ssh_file',
        find: `  tauriContracts.downloadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000 },`,
        replace: `  tauriContracts.downloadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000, measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 upload_ssh_file',
        find: `  tauriContracts.uploadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000 },`,
        replace: `  tauriContracts.uploadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000, measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 read_ssh_file',
        find: `  tauriContracts.readSshFile,
  { idempotent: true, audit: 'sensitive', timeoutMs: 60_000 },`,
        replace: `  tauriContracts.readSshFile,
  { idempotent: true, audit: 'sensitive', timeoutMs: 60_000, measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 write_ssh_file (content+password)',
        find: `    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['content']),`,
        replace: `    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['content', 'password']),`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 delete_ssh_path',
        find: `  tauriContracts.deleteSshPath,
  { audit: 'sensitive', timeoutMs: 30_000 },`,
        replace: `  tauriContracts.deleteSshPath,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 rename_ssh_path',
        find: `  tauriContracts.renameSshPath,
  { audit: 'sensitive', timeoutMs: 30_000 },`,
        replace: `  tauriContracts.renameSshPath,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },`,
    },
    {
        file: 'src/services/tauri.ts',
        label: 'F5 create_ssh_directory',
        find: `  tauriContracts.createSshDirectory,
  { audit: 'sensitive', timeoutMs: 30_000 },`,
        replace: `  tauriContracts.createSshDirectory,
  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },`,
    },

    // ── SshSidebarPanel.vue · F1/F3 常量 ──────────────────────────────
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F1+F3 常量',
        find: `const TERMINAL_OPEN_DELAY_MS = 120;
const SSH_PASSWORD_SEND_DELAY_MS = 180;`,
        replace: `const TERMINAL_OPEN_DELAY_MS = 120;
// SSH 终端会话主机密钥策略：accept-new 首次自动信任、之后密钥变更则拒绝(TOFU)。
const SSH_TERMINAL_HOST_KEY_POLICY = 'accept-new';`,
    },
    // F1：不再向终端注入明文密码
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F1 移除明文密码注入',
        find: `    await terminalControls.sendCommand(sshCommandPreview.value);
    if (connectionForm.authMode === 'password') {
      await new Promise((resolve) => window.setTimeout(resolve, SSH_PASSWORD_SEND_DELAY_MS));
      await terminalControls.sendInput(\`\${connectionForm.password}\\n\`);
    }`,
        replace: `    await terminalControls.sendCommand(sshCommandPreview.value);
    if (connectionForm.authMode === 'password') {
      message.info('终端会话已打开，请在终端中手动输入 SSH 登录密码。');
    }`,
    },
    // F3a：主机密钥校验对两种认证方式都生效
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F3a 通用 StrictHostKeyChecking',
        find: `  const parts = ['ssh', '-p', quoteShellArg(portText)];

  if (connectionForm.authMode === 'key' && connectionForm.identityPath.trim()) {`,
        replace: `  const parts = ['ssh', '-p', quoteShellArg(portText)];

  // 与文件通道(russh)的 TOFU 策略保持一致：首次自动信任、密钥变更时拒绝。
  parts.push('-o', \`StrictHostKeyChecking=\${SSH_TERMINAL_HOST_KEY_POLICY}\`);

  if (connectionForm.authMode === 'key' && connectionForm.identityPath.trim()) {`,
    },
    // F3b：从密码分支移除重复的 StrictHostKeyChecking
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F3b 去重',
        find: `      '-o',
      'NumberOfPasswordPrompts=1',
      '-o',
      'StrictHostKeyChecking=accept-new',
    );`,
        replace: `      '-o',
      'NumberOfPasswordPrompts=1',
    );`,
    },
    // F2：断开时清除内存中残留的明文密码
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F2 清除残留密码',
        find: `  sshStore.clearConnectionState();
  resetForm();
  message.info('已断开 SSH 文件会话。');`,
        replace: `  sshStore.clearConnectionState();
  resetForm();
  // 清除内存中残留的明文密码，避免断开后仍驻留。
  sshStore.connectionForm.password = '';
  message.info('已断开 SSH 文件会话。');`,
    },
    // F6：单击仅选中/进目录，双击才预览文件(避免单击触发整文件 SFTP 读取)
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F6a 拆分单击/双击',
        find: `const handleSelectFile = (fileId: string): void => {
  selectedFileId.value = fileId;
  closeContextMenu();

  const fileItem = sshFileItems.value.find((item) => item.id === fileId);
  if (fileItem?.isDirectory && !isRemoteDirectoryLoading.value) {
    void loadRemoteDirectory(fileItem.path);
    return;
  }
  if (fileItem && !fileItem.isDirectory) {
    void previewRemoteFile(fileItem);
  }
};`,
        replace: `const handleSelectFile = (fileId: string): void => {
  selectedFileId.value = fileId;
  closeContextMenu();

  const fileItem = sshFileItems.value.find((item) => item.id === fileId);
  if (fileItem?.isDirectory && !isRemoteDirectoryLoading.value) {
    void loadRemoteDirectory(fileItem.path);
  }
};

const handleOpenFile = (fileId: string): void => {
  const fileItem = sshFileItems.value.find((item) => item.id === fileId);
  if (fileItem?.isDirectory && !isRemoteDirectoryLoading.value) {
    void loadRemoteDirectory(fileItem.path);
    return;
  }
  if (fileItem && !fileItem.isDirectory) {
    void previewRemoteFile(fileItem);
  }
};`,
    },
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        label: 'F6b 模板 dblclick',
        find: `@click="handleSelectFile(item.id)"
              @contextmenu.prevent="handleFileContextMenu($event, item.id)">`,
        replace: `@click="handleSelectFile(item.id)"
              @dblclick="handleOpenFile(item.id)"
              @contextmenu.prevent="handleFileContextMenu($event, item.id)">`,
    },
];

const root = process.cwd();
let content = {};
for (const e of edits) {
    if (!(e.file in content)) {
        content[e.file] = fs.readFileSync(path.join(root, e.file), 'utf8');
    }
    content[e.file] = replaceOnce(content[e.file], e.find, e.replace, e.label);
    console.log(`✓ ${e.label}`);
}
for (const file of Object.keys(content)) {
    fs.writeFileSync(path.join(root, file), content[file]);
    console.log(`已写入 ${file}`);
}
console.log('全部完成。请用 git diff 核对后提交。');