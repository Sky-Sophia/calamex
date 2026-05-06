import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
const SRC_TAURI_DIR = resolve(WORKSPACE_ROOT, 'src-tauri');
const TARGET = process.env.CALAMEX_WSL_LINK_AGENT_TARGET ?? 'x86_64-unknown-linux-gnu';
const PROFILE = process.env.CALAMEX_WSL_LINK_AGENT_PROFILE ?? 'release';
const DISTRO = process.env.CALAMEX_WSL_LINK_DISTRO?.trim();
const OUTPUT_PATH = resolve(
  SRC_TAURI_DIR,
  'binaries',
  'wsl-link',
  `wsl-link-agent-${TARGET}`,
);

const wslPrefix = DISTRO ? ['--distribution', DISTRO] : [];

const shQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
const escapeWslDollars = (value) => value.replaceAll('$', '\\$');

const run = (program, args, options = {}) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const text = chunk.replaceAll('\u0000', '');
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.replaceAll('\u0000', '');
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(`${program} 退出码 ${code ?? 'unknown'}\n${stderr.trim()}`));
    });
  });

const resolveWorkspaceInWsl = async () => {
  const result = await run('wsl.exe', [
    ...wslPrefix,
    '--',
    'sh',
    '-lc',
    `wslpath -a ${shQuote(WORKSPACE_ROOT)}`,
  ]);
  return result.stdout.trim();
};

const buildAgent = async (workspaceInWsl) => {
  if (PROFILE !== 'release' && PROFILE !== 'debug') {
    throw new Error('CALAMEX_WSL_LINK_AGENT_PROFILE 只能是 release 或 debug。');
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

  const releaseFlag = PROFILE === 'release' ? '--release' : '';
  const script = `
set -eu
workspace=${shQuote(workspaceInWsl)}
target=${shQuote(TARGET)}
profile=${shQuote(PROFILE)}
cd "$workspace/src-tauri"
if ! command -v cargo >/dev/null 2>&1; then
  printf 'WSL 内未找到 cargo。请先在目标 WSL 发行版安装 Rust 工具链。\\n' >&2
  exit 127
fi
cargo build --bin wsl_link_agent --target "$target" --features wsl-link-agent --no-default-features ${releaseFlag}
artifact="$workspace/target/$target/$profile/wsl_link_agent"
dest="$workspace/src-tauri/binaries/wsl-link/wsl-link-agent-$target"
test -x "$artifact"
mkdir -p "$(dirname "$dest")"
install -m 0755 "$artifact" "$dest"
printf 'WSL Link agent artifact: %s\\n' "$dest"
`;

  await run('wsl.exe', [...wslPrefix, '--', 'sh', '-lc', escapeWslDollars(script)]);
};

try {
  const workspaceInWsl = await resolveWorkspaceInWsl();
  await buildAgent(workspaceInWsl);
  console.log(`WSL Link agent Windows artifact: ${OUTPUT_PATH}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`构建 WSL Link agent 失败：${message}`);
  process.exitCode = 1;
}
