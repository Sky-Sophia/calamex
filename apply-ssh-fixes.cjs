$dir = Join - Path(Get - Location) 'scripts'
if (-not(Test - Path $dir)) { New - Item - ItemType Directory - Path $dir | Out - Null }
$code = @'
const fs = require('fs');
const path = require('path');

function replaceOnce(content, search, replace, label) {
    const segments = content.split(search);
    const matches = segments.length - 1;
    if (matches !== 1) {
        throw new Error('[' + label + '] expected exactly 1 match, found ' + matches);
    }
    return segments.join(replace);
}

const plan = [
    {
        file: 'src/services/tauri.ts',
        edits: [
            {
                label: 'F5-1 add measureSshSecretInput helper',
                search: "const measureAiInlineCompletionInput = <T extends Record<string, unknown>>(\n  value: T,\n): IPayloadMetrics =>\n  buildPayloadMetricsOmittingTextFields(value, ['prefix', 'suffix', 'recentEdits']);",
                replace: "const measureAiInlineCompletionInput = <T extends Record<string, unknown>>(\n  value: T,\n): IPayloadMetrics =>\n  buildPayloadMetricsOmittingTextFields(value, ['prefix', 'suffix', 'recentEdits']);\n\nconst measureSshSecretInput = <T extends Record<string, unknown>>(\n  value: T,\n): IPayloadMetrics => buildPayloadMetricsOmittingTextFields(value, ['password']);"
            },
            {
                label: 'F5-2 testSshConnection',
                search: "  tauriContracts.testSshConnection,\n  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },",
                replace: "  tauriContracts.testSshConnection,\n  {\n    idempotent: true,\n    timeoutMs: 15_000,\n    audit: 'sensitive',\n    measureInput: measureSshSecretInput,\n  },"
            },
            {
                label: 'F5-3 saveSshPassword',
                search: "  tauriContracts.saveSshPassword,\n  { audit: 'sensitive' },",
                replace: "  tauriContracts.saveSshPassword,\n  { audit: 'sensitive', measureInput: measureSshSecretInput },"
            },
            {
                label: 'F5-4 listSshDirectory',
                search: "  tauriContracts.listSshDirectory,\n  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },",
                replace: "  tauriContracts.listSshDirectory,\n  {\n    idempotent: true,\n    timeoutMs: 15_000,\n    audit: 'sensitive',\n    measureInput: measureSshSecretInput,\n  },"
            },
            {
                label: 'F5-5 downloadSshFile',
                search: "  tauriContracts.downloadSshFile,\n  { audit: 'sensitive', timeoutMs: 60_000 },",
                replace: "  tauriContracts.downloadSshFile,\n  { audit: 'sensitive', timeoutMs: 60_000, measureInput: measureSshSecretInput },"
            },
            {
                label: 'F5-6 uploadSshFile',
                search: "  tauriContracts.uploadSshFile,\n  { audit: 'sensitive', timeoutMs: 60_000 },",
                replace: "  tauriContracts.uploadSshFile,\n  { audit: 'sensitive', timeoutMs: 60_000, measureInput: measureSshSecretInput },"
            },
            {
                label: 'F5-7 readSshFile',
                search: "  tauriContracts.readSshFile,\n  { idempotent: true, audit: 'sensitive', timeoutMs: 60_000 },",
                replace: "  tauriContracts.readSshFile,\n  {\n    idempotent: true,\n    audit: 'sensitive',\n    timeoutMs: 60_000,\n    measureInput: measureSshSecretInput,\n  },"
            },
            {
                label: 'F5-8 writeSshFile (content+password)',
                search: "    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['content']),",
                replace: "    measureInput: (value) =>\n      buildPayloadMetricsOmittingTextFields(value, ['content', 'password']),"
            },
            {
                label: 'F5-9 deleteSshPath',
                search: "  tauriContracts.deleteSshPath,\n  { audit: 'sensitive', timeoutMs: 30_000 },",
                replace: "  tauriContracts.deleteSshPath,\n  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },"
            },
            {
                label: 'F5-10 renameSshPath',
                search: "  tauriContracts.renameSshPath,\n  { audit: 'sensitive', timeoutMs: 30_000 },",
                replace: "  tauriContracts.renameSshPath,\n  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },"
            },
            {
                label: 'F5-11 createSshDirectory',
                search: "  tauriContracts.createSshDirectory,\n  { audit: 'sensitive', timeoutMs: 30_000 },",
                replace: "  tauriContracts.createSshDirectory,\n  { audit: 'sensitive', timeoutMs: 30_000, measureInput: measureSshSecretInput },"
            }
        ]
    },
    {
        file: 'src/components/workbench/SshSidebarPanel.vue',
        edits: [
            {
                label: 'F1+F3 consts',
                search: "const TERMINAL_OPEN_DELAY_MS = 120;\nconst SSH_PASSWORD_SEND_DELAY_MS = 180;",
                replace: "const TERMINAL_OPEN_DELAY_MS = 120;\nconst SSH_TERMINAL_HOST_KEY_POLICY = 'accept-new';"
            },
            {
                label: 'F1 no plaintext password into terminal',
                search: "    await terminalControls.sendCommand(sshCommandPreview.value);\n    if (connectionForm.authMode === 'password') {\n      await new Promise((resolve) => window.setTimeout(resolve, SSH_PASSWORD_SEND_DELAY_MS));\n      await terminalControls.sendInput(`${connectionForm.password}\\n`);\n    }",
                replace: "    await terminalControls.sendCommand(sshCommandPreview.value);\n    if (connectionForm.authMode === 'password') {\n      message.info('终端会话已打开，请在终端中手动输入 SSH 登录密码。');\n    }"
            },
            {
                label: 'F2 clear password on disconnect',
                search: "  sshStore.clearConnectionState();\n  resetForm();",
                replace: "  sshStore.clearConnectionState();\n  resetForm();\n  sshStore.connectionForm.password = '';"
            },
            {
                label: 'F3 unify StrictHostKeyChecking',
                search: "  const parts = ['ssh', '-p', quoteShellArg(portText)];\n\n  if (connectionForm.authMode === 'key' && connectionForm.identityPath.trim()) {\n    parts.push('-i', quoteShellArg(connectionForm.identityPath));\n  }\n\n  if (connectionForm.authMode === 'password') {\n    parts.push(\n      '-o',\n      'PreferredAuthentications=password',\n      '-o',\n      'PubkeyAuthentication=no',\n      '-o',\n      'NumberOfPasswordPrompts=1',\n      '-o',\n      'StrictHostKeyChecking=accept-new',\n    );\n  }",
                replace: "  const parts = ['ssh', '-p', quoteShellArg(portText)];\n  parts.push('-o', `StrictHostKeyChecking=${SSH_TERMINAL_HOST_KEY_POLICY}`);\n\n  if (connectionForm.authMode === 'key' && connectionForm.identityPath.trim()) {\n    parts.push('-i', quoteShellArg(connectionForm.identityPath));\n  }\n\n  if (connectionForm.authMode === 'password') {\n    parts.push(\n      '-o',\n      'PreferredAuthentications=password',\n      '-o',\n      'PubkeyAuthentication=no',\n      '-o',\n      'NumberOfPasswordPrompts=1',\n    );\n  }"
            },
            {
                label: 'F6 split select/open',
                search: "const handleSelectFile = (fileId: string): void => {\n  selectedFileId.value = fileId;\n  closeContextMenu();\n\n  const fileItem = sshFileItems.value.find((item) => item.id === fileId);\n  if (fileItem?.isDirectory && !isRemoteDirectoryLoading.value) {\n    void loadRemoteDirectory(fileItem.path);\n    return;\n  }\n  if (fileItem && !fileItem.isDirectory) {\n    void previewRemoteFile(fileItem);\n  }\n};",
                replace: "const handleSelectFile = (fileId: string): void => {\n  selectedFileId.value = fileId;\n  closeContextMenu();\n\n  const fileItem = sshFileItems.value.find((item) => item.id === fileId);\n  if (fileItem?.isDirectory && !isRemoteDirectoryLoading.value) {\n    void loadRemoteDirectory(fileItem.path);\n  }\n};\n\nconst handleOpenFile = (fileId: string): void => {\n  const fileItem = sshFileItems.value.find((item) => item.id === fileId);\n  if (!fileItem) return;\n  if (fileItem.isDirectory) {\n    if (!isRemoteDirectoryLoading.value) {\n      void loadRemoteDirectory(fileItem.path);\n    }\n    return;\n  }\n  void previewRemoteFile(fileItem);\n};"
            },
            {
                label: 'F6 template @dblclick',
                search: ' @click="handleSelectFile(item.id)"\n              @contextmenu.prevent="handleFileContextMenu($event, item.id)">',
                replace: ' @click="handleSelectFile(item.id)"\n              @dblclick="handleOpenFile(item.id)"\n              @contextmenu.prevent="handleFileContextMenu($event, item.id)">'
            }
        ]
    }
];

const staged = [];
for (const { file, edits } of plan) {
    const abs = path.resolve(process.cwd(), file);
    let content = fs.readFileSync(abs, 'utf8');
    for (const e of edits) {
        content = replaceOnce(content, e.search, e.replace, e.label);
        console.log('OK  ' + e.label);
    }
    staged.push({ abs, file, content });
}
for (const s of staged) {
    fs.writeFileSync(s.abs, s.content, 'utf8');
    console.log('WROTE ' + s.file);
}
console.log('Done.');
'@
Set - Content - LiteralPath(Join - Path $dir 'apply-ssh-fixes.cjs') - Value $code - Encoding utf8
node scripts / apply - ssh - fixes.cjs