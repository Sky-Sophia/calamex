import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DismissDetail, type MessageDetail, useMessage } from '@/composables/useMessage';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('vue-sonner', () => ({
  toast: toastMock,
}));

describe('useMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('发送 Sonner toast，同时保留 app-message 事件', () => {
    let eventDetail: MessageDetail | null = null;
    window.addEventListener(
      'app-message',
      (event) => {
        eventDetail = event.detail;
      },
      { once: true },
    );

    const handle = useMessage().error('保存失败', {
      id: 'save-error',
      description: '网络连接中断，请稍后重试。',
      duration: 7_000,
    });

    expect(handle.id).toBe('save-error');
    expect(eventDetail).toMatchObject({
      id: 'save-error',
      type: 'error',
      message: '保存失败',
      description: '网络连接中断，请稍后重试。',
      duration: 7_000,
    });
    expect(toastMock.error).toHaveBeenCalledWith('保存失败', {
      id: 'save-error',
      description: '网络连接中断，请稍后重试。',
      duration: 7_000,
      closeButton: true,
    });
  });

  it('关闭消息时同步关闭 Sonner toast 和旧事件通道', () => {
    let dismissDetail: DismissDetail | null = null;
    window.addEventListener(
      'app-message-dismiss',
      (event) => {
        dismissDetail = event.detail;
      },
      { once: true },
    );

    useMessage().dismiss('save-error');

    expect(toastMock.dismiss).toHaveBeenCalledWith('save-error');
    expect(dismissDetail).toEqual({ id: 'save-error' });
  });

  it('成功消息不再弹出 Toast，但仍保留 app-message 事件', () => {
    let eventDetail: MessageDetail | null = null;
    window.addEventListener(
      'app-message',
      (event) => {
        eventDetail = event.detail;
      },
      { once: true },
    );

    useMessage().success('保存成功', { id: 'save-ok' });

    expect(toastMock.success).not.toHaveBeenCalled();
    // 顺手关闭同 id 上可能残留的进行中 Toast（如 loading 转圈）。
    expect(toastMock.dismiss).toHaveBeenCalledWith('save-ok');
    expect(eventDetail).toMatchObject({ id: 'save-ok', type: 'success', message: '保存成功' });
  });

  it('info 提示不再弹出 Toast', () => {
    useMessage().info('仅供参考的提示');

    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it('警告与错误仍然弹出 Toast', () => {
    useMessage().warning('请注意检查输入');
    useMessage().error('操作失败');

    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it('loading 进度仍然弹出 Toast', () => {
    useMessage().loading('正在保存…');

    expect(toastMock.loading).toHaveBeenCalledTimes(1);
  });
});
