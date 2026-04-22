#!/usr/bin/env node
/**
 * 开发环境自检脚本
 * 在 pnpm tauri:dev 启动前执行，快速发现常见环境问题：
 *   1. pnpm 是否可用
 *   2. .cargo/config.toml 是否配置了镜像源
 *   3. cargo 是否可用
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

let hasError = false

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function warn(msg) {
  console.warn(`  ⚠ ${msg}`)
}

function fail(msg) {
  console.error(`  ✗ ${msg}`)
  hasError = true
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

console.log('\n[check-dev-env] 开始环境自检...\n')

// 1. pnpm 可用性
const pnpmVer = run('pnpm --version') ?? run('corepack pnpm --version')
if (pnpmVer) {
  ok(`pnpm ${pnpmVer}`)
} else {
  fail('找不到 pnpm，请运行: corepack enable && corepack prepare pnpm@latest --activate')
}

// 2. .cargo/config.toml 是否存在且配置了镜像源
const cargoConfig = join(ROOT, '.cargo', 'config.toml')
if (!existsSync(cargoConfig)) {
  fail(`.cargo/config.toml 不存在，Rust 依赖将使用官方源，在国内网络下可能失败。
    修复：创建 .cargo/config.toml 并配置 rsproxy-sparse 镜像。`)
} else {
  const content = readFileSync(cargoConfig, 'utf-8')
  if (content.includes('replace-with') && content.includes('rsproxy')) {
    ok('.cargo/config.toml 已配置镜像源（rsproxy）')
  } else {
    warn('.cargo/config.toml 存在，但未检测到 rsproxy 镜像配置，遇到下载问题时请检查该文件。')
  }
  if (content.includes('git-fetch-with-cli = true')) {
    ok('git-fetch-with-cli = true（可避免 Windows schannel 握手问题）')
  } else {
    warn('未设置 git-fetch-with-cli = true，在 Windows 下可能遇到 TLS 握手错误。')
  }
}

// 3. cargo 可用性
const cargoVer = run('cargo --version')
if (cargoVer) {
  ok(cargoVer)
} else {
  fail('找不到 cargo，请安装 Rust toolchain: https://rustup.rs')
}

console.log()

if (hasError) {
  console.error('[check-dev-env] 环境检查发现错误，请先修复后再启动。\n')
  process.exit(1)
} else {
  console.log('[check-dev-env] 环境检查通过。\n')
}
