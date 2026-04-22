/**
 * Vitest 全局测试 setup
 * 模拟 Tauri API 环境（避免测试中调用真实 IPC）
 */
import { vi } from 'vitest';

// 模拟 @tauri-apps/api/core 的 invoke
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn().mockRejectedValue(new Error('Tauri IPC not available in test environment')),
}));

// 模拟 @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(() => { }),
    emit: vi.fn().mockResolvedValue(undefined),
    once: vi.fn().mockResolvedValue(() => { }),
}));

// 模拟 @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
}));
