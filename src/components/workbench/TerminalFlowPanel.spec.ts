import { useTerminalRuntimeStore } from '@/store/terminal';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import TerminalFlowPanel from './TerminalFlowPanel.vue';

const mountPanel = () =>
  mount(TerminalFlowPanel, {
    props: {
      terminalStatus: {
        state: 'ready',
        message: 'WSL2 ready',
      },
      isRunning: true,
      terminalOutputLength: 12,
      terminalOutputVersion: 3,
    },
  });

describe('TerminalFlowPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps deep diagnostics off until the user enables it', async () => {
    const store = useTerminalRuntimeStore();
    const wrapper = mountPanel();

    expect(store.deepDiagnosticsEnabled).toBe(false);
    expect(wrapper.text()).toContain('开启深度诊断');

    const diagnosticsButton = wrapper.findAll('.terminal-flow-toggle-button')[0];
    expect(diagnosticsButton).toBeDefined();
    await diagnosticsButton?.trigger('click');

    expect(store.deepDiagnosticsEnabled).toBe(true);
    expect(wrapper.text()).toContain('关闭深度诊断');
  });

  it('renders runtime state, run id, event counters and separator toggle', async () => {
    const store = useTerminalRuntimeStore();
    store.setDeepDiagnosticsEnabled(true);
    store.markInteractiveReady();
    store.markRunStarted({
      runId: 'run-ui-1',
      sessionId: 'run-session-1',
      cwd: '/workspace',
      commandLine: '/bin/bash /tmp/run.sh',
      usedTempFile: true,
      startedAt: '2026-04-25T00:00:00.000Z',
    });
    store.recordRunChunk('run-ui-1', 'hello\n');
    store.recordInputRoute('run', new TextEncoder().encode('a'));

    const wrapper = mountPanel();

    expect(wrapper.text()).toContain('Terminal flow');
    expect(wrapper.text()).toContain('run-ui-1');
    expect(wrapper.text()).toContain('terminal:run-chunk');
    expect(wrapper.text()).toContain('1 chunks');
    expect(wrapper.text()).toContain('rPTY');

    const toggleButtons = wrapper.findAll('.terminal-flow-toggle-button');
    expect(toggleButtons).toHaveLength(2);
    await toggleButtons[0]?.trigger('click');

    expect(store.deepDiagnosticsEnabled).toBe(false);

    await toggleButtons[1]?.trigger('click');

    expect(store.showRunSeparator).toBe(false);
  });

  it('renders child.wait completion result', () => {
    const store = useTerminalRuntimeStore();
    store.setDeepDiagnosticsEnabled(true);
    store.markInteractiveReady();
    store.markRunStarted({
      runId: 'run-completed-1',
      sessionId: 'run-session-1',
      cwd: '/workspace',
      commandLine: '/bin/bash /tmp/run.sh',
      usedTempFile: true,
      startedAt: '2026-04-25T00:00:00.000Z',
    });
    store.markRunCompleted('run-completed-1', 0, '2026-04-25T00:00:01.000Z');

    const wrapper = mount(TerminalFlowPanel, {
      props: {
        terminalStatus: {
          state: 'ready',
          message: 'WSL2 ready',
        },
        isRunning: false,
        terminalOutputLength: 0,
        terminalOutputVersion: 0,
      },
    });

    expect(wrapper.text()).toContain('exit 0');
    expect(wrapper.text()).toContain('terminal:run-completed');
  });

  it('keeps event details in a keyboard-scrollable region', () => {
    const wrapper = mountPanel();
    const scrollRegion = wrapper.find('.terminal-flow-scroll-region');

    expect(scrollRegion.exists()).toBe(true);
    expect(scrollRegion.attributes('role')).toBe('region');
    expect(scrollRegion.attributes('aria-label')).toBe('终端事件流详情');
    expect(scrollRegion.attributes('tabindex')).toBe('0');
  });
});
