import { z } from 'zod';
import { useDialog } from '@/composables/useDialog';
import { AppError, isAppError } from '@/types/app-error';
import type { ITauriService } from '@/types/tauri';
import { tauriContracts } from './tauri.contracts';
import { defineContractIpc, defineIpc, definePayloadIpc } from './tauri.ipc-factory';
import { buildPayloadMetricsOmittingTextFields } from './tauri.ipc-metrics';
import type { IIpcCallOptions } from './tauri.ipc-types';

const testSshConnectionIpc = definePayloadIpc(
  'test_ssh_connection',
  '测试 SSH 连接',
  tauriContracts.testSshConnection,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },
);

const saveSshPasswordIpc = definePayloadIpc(
  'save_ssh_password',
  '保存 SSH 密码',
  tauriContracts.saveSshPassword,
  { audit: 'sensitive' },
);

const getSshPasswordIpc = definePayloadIpc(
  'get_ssh_password',
  '读取 SSH 密码',
  tauriContracts.getSshPassword,
  { idempotent: true, audit: 'sensitive' },
);

const listSshConfigHostsIpc = defineContractIpc(
  'list_ssh_config_hosts',
  '读取 SSH 配置主机',
  tauriContracts.listSshConfigHosts,
  { idempotent: true, audit: 'sensitive' },
);

const listSshDirectoryIpc = definePayloadIpc(
  'list_ssh_directory',
  '读取 SSH 远端目录',
  tauriContracts.listSshDirectory,
  { idempotent: true, timeoutMs: 15_000, audit: 'sensitive' },
);

const downloadSshFileIpc = definePayloadIpc(
  'download_ssh_file',
  '下载 SSH 远端文件',
  tauriContracts.downloadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000 },
);

const uploadSshFileIpc = definePayloadIpc(
  'upload_ssh_file',
  '上传 SSH 远端文件',
  tauriContracts.uploadSshFile,
  { audit: 'sensitive', timeoutMs: 60_000 },
);

const readSshFileIpc = definePayloadIpc(
  'read_ssh_file',
  '读取 SSH 远端文件',
  tauriContracts.readSshFile,
  { idempotent: true, audit: 'sensitive', timeoutMs: 60_000 },
);

const writeSshFileIpc = definePayloadIpc(
  'write_ssh_file',
  '写入 SSH 远端文件',
  tauriContracts.writeSshFile,
  {
    audit: 'sensitive',
    timeoutMs: 60_000,
    measureInput: (value) => buildPayloadMetricsOmittingTextFields(value, ['content']),
  },
);

const deleteSshPathIpc = definePayloadIpc(
  'delete_ssh_path',
  '删除 SSH 远端路径',
  tauriContracts.deleteSshPath,
  { audit: 'sensitive', timeoutMs: 30_000 },
);

const renameSshPathIpc = definePayloadIpc(
  'rename_ssh_path',
  '重命名 SSH 远端路径',
  tauriContracts.renameSshPath,
  { audit: 'sensitive', timeoutMs: 30_000 },
);

const createSshDirectoryIpc = definePayloadIpc(
  'create_ssh_directory',
  '创建 SSH 远端目录',
  tauriContracts.createSshDirectory,
  { audit: 'sensitive', timeoutMs: 30_000 },
);

/**
 * SSH 主机密钥变更处理。
 *
 * 后端在检测到 known_hosts 中已记录的主机密钥发生变化时，不再直接拒绝，而是返回
 * 携带 `ssh/host-key-changed::<fingerprint>` 标记的错误（文件类操作）或在
 * `test_ssh_connection` 的结构化返回中以 `code` 体现。前端在此弹出危险确认弹窗，
 * 用户确认后调用 `trust_ssh_host_key` 记录新密钥为信任并无感重试原操作。
 */
const SSH_HOST_KEY_CHANGED_CODE = 'ssh/host-key-changed';

const trustSshHostKeyIpc = defineIpc({
  name: 'trust_ssh_host_key',
  guardHint: '信任变更后的 SSH 主机密钥',
  inSchema: z.object({ host: z.string(), port: z.number() }),
  outSchema: z.object({ trusted: z.boolean() }),
  audit: 'sensitive',
  timeoutMs: 15_000,
});

interface ISshHostKeyEndpoint {
  host: string;
  port: number;
}

const extractChangedHostKeyFingerprint = (message: string): string | null => {
  const marker = `${SSH_HOST_KEY_CHANGED_CODE}::`;
  const markerIndex = message.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const rawFingerprint = message.slice(markerIndex + marker.length).trim();
  if (!rawFingerprint) {
    return null;
  }

  const [fingerprint] = rawFingerprint.split(/\s+/);
  return fingerprint || null;
};

const isHostKeyChangedError = (error: unknown): error is AppError =>
  isAppError(error) && error.message.includes(SSH_HOST_KEY_CHANGED_CODE);

const confirmTrustChangedHostKey = async (
  endpoint: ISshHostKeyEndpoint,
  fingerprint: string | null,
): Promise<boolean> => {
  const target = `${endpoint.host}:${endpoint.port}`;
  const fingerprintLine = fingerprint ? `新的密钥指纹：${fingerprint}。` : '';
  const action = await useDialog().confirm({
    title: '主机密钥已变更',
    description: `服务器 ${target} 的主机密钥与本地记录不一致。${fingerprintLine}这可能是服务器重装，也可能是中间人攻击。确认信任后将记录新密钥并继续。`,
    variant: 'danger',
    confirmText: '信任并继续',
    cancelText: '取消',
  });
  return action === 'confirm';
};

const withChangedHostKeyPrompt = <TInput extends ISshHostKeyEndpoint, TOutput>(
  operation: (input: TInput, options?: IIpcCallOptions) => Promise<TOutput>,
) => {
  return async (input: TInput, options?: IIpcCallOptions): Promise<TOutput> => {
    try {
      return await operation(input, options);
    } catch (error) {
      if (!isHostKeyChangedError(error)) {
        throw error;
      }

      const fingerprint = extractChangedHostKeyFingerprint(error.message);
      const trusted = await confirmTrustChangedHostKey(input, fingerprint);
      if (!trusted) {
        throw error;
      }

      await trustSshHostKeyIpc({ host: input.host, port: input.port });
      return operation(input, options);
    }
  };
};

const testSshConnectionWithHostKeyPrompt: typeof testSshConnectionIpc = async (input, options) => {
  const result = await testSshConnectionIpc(input, options);
  if (result.code !== SSH_HOST_KEY_CHANGED_CODE) {
    return result;
  }

  const fingerprint = extractChangedHostKeyFingerprint(result.message);
  const endpoint: ISshHostKeyEndpoint = { host: input.host, port: input.port };
  const trusted = await confirmTrustChangedHostKey(endpoint, fingerprint);
  if (!trusted) {
    return result;
  }

  await trustSshHostKeyIpc({ host: endpoint.host, port: endpoint.port });
  return testSshConnectionIpc(input, options);
};

type TSshTauriService = Pick<
  ITauriService,
  | 'testSshConnection'
  | 'saveSshPassword'
  | 'getSshPassword'
  | 'listSshConfigHosts'
  | 'listSshDirectory'
  | 'downloadSshFile'
  | 'uploadSshFile'
  | 'readSshFile'
  | 'writeSshFile'
  | 'deleteSshPath'
  | 'renameSshPath'
  | 'createSshDirectory'
>;

export const sshTauriService: TSshTauriService = {
  testSshConnection: testSshConnectionWithHostKeyPrompt,

  saveSshPassword: saveSshPasswordIpc,

  getSshPassword: getSshPasswordIpc,

  listSshConfigHosts: () => listSshConfigHostsIpc(undefined),

  listSshDirectory: withChangedHostKeyPrompt(listSshDirectoryIpc),

  downloadSshFile: withChangedHostKeyPrompt(downloadSshFileIpc),

  uploadSshFile: withChangedHostKeyPrompt(uploadSshFileIpc),

  readSshFile: withChangedHostKeyPrompt(readSshFileIpc),

  writeSshFile: withChangedHostKeyPrompt(writeSshFileIpc),

  deleteSshPath: withChangedHostKeyPrompt(deleteSshPathIpc),

  renameSshPath: withChangedHostKeyPrompt(renameSshPathIpc),

  createSshDirectory: withChangedHostKeyPrompt(createSshDirectoryIpc),
};
