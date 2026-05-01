import {
  aiAgentApprovePlanRequestSchema,
  aiAgentSetNetworkPermissionRequestSchema,
  aiAgentStepDetailSchema,
  aiAgentTimelineItemSchema,
  aiAgentRunPayloadSchema,
  aiAgentRunPlanRequestSchema,
  aiAgentPermissionStateSchema,
  aiAgentPlanPayloadSchema,
} from '@/types/ai-agent.schema';
import { describe, expect, it } from 'vitest';

const createStep = (index: number) => ({
  id: `step-${index}`,
  index,
  title: `步骤 ${index + 1}`,
  goal: `完成步骤 ${index + 1}`,
  kind: index === 0 ? 'inspect' : 'verify',
  status: 'pending',
  expectedOutput: `产物 ${index + 1}`,
  tools: index === 0 ? ['search_text'] : ['run_test'],
  requiresUserApproval: index > 0,
  riskLevel: index === 0 ? 'low' : 'medium',
});

describe('AI agent schema', () => {
  it('接受 2~6 步的计划', () => {
    const parsed = aiAgentPlanPayloadSchema.parse({
      steps: [createStep(0), createStep(1)],
    });

    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]?.tools).toEqual(['search_text']);
  });

  it('accepts Rust plan payload with nullable optional fields', () => {
    const parsed = aiAgentPlanPayloadSchema.parse({
      steps: [
        {
          ...createStep(0),
          toolInputs: null,
          references: null,
          isActive: null,
          rollbackStrategy: null,
        },
        {
          ...createStep(1),
          toolInputs: {
            webSearch: null,
            webFetch: null,
            proposePatch: null,
            autoApplyPatch: null,
            runCommand: null,
            stageFile: null,
            createCommit: null,
          },
          references: null,
          isActive: null,
          rollbackStrategy: '只读步骤无需回滚',
        },
      ],
    });

    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0]?.toolInputs).toBeUndefined();
    expect(parsed.steps[0]?.references).toBeUndefined();
    expect(parsed.steps[0]?.isActive).toBeUndefined();
    expect(parsed.steps[0]?.rollbackStrategy).toBeUndefined();
    expect(parsed.steps[1]?.toolInputs?.webSearch).toBeUndefined();
  });

  it('拒绝少于 2 步的计划', () => {
    expect(() =>
      aiAgentPlanPayloadSchema.parse({
        steps: [createStep(0)],
      }),
    ).toThrow();
  });

  it('拒绝未知工具名', () => {
    expect(() =>
      aiAgentApprovePlanRequestSchema.parse({
        goal: '补齐 Plan Mode 契约',
        steps: [{
          ...createStep(0),
          tools: ['unknown_tool'],
        }],
      }),
    ).toThrow();
  });

  it('校验权限状态仅接受受控高风险工具', () => {
    const parsed = aiAgentPermissionStateSchema.parse({
      level: 'elevated',
      scope: 'run',
      grantedAt: '2026-04-29T10:00:00.000Z',
      allowedHighRiskTools: ['run_command', 'create_commit'],
    });

    expect(parsed.allowedHighRiskTools).toEqual(['run_command', 'create_commit']);
  });

  it('仅接受受控的网络权限值', () => {
    const parsed = aiAgentSetNetworkPermissionRequestSchema.parse({
      permission: 'allowed-this-run',
    });

    expect(parsed.permission).toBe('allowed-this-run');
    expect(() =>
      aiAgentSetNetworkPermissionRequestSchema.parse({
        permission: 'always',
      }),
    ).toThrow();
  });

  it('校验 run_plan 请求与 run payload', () => {
    const steps = [createStep(0), createStep(1)];
    const request = aiAgentRunPlanRequestSchema.parse({
      goal: '实现 Step Runtime',
      steps,
    });

    expect(request.steps).toHaveLength(2);

    const payload = aiAgentRunPayloadSchema.parse({
      run: {
        id: 'agent-run-1',
        goal: request.goal,
        status: 'running-plan',
        steps,
        currentStepId: null,
        createdAt: '2026-04-29T10:00:00.000Z',
        updatedAt: '2026-04-29T10:00:00.000Z',
        startedAt: '2026-04-29T10:00:00.000Z',
        completedAt: null,
        errorMessage: null,
      },
    });

    expect(payload.run.status).toBe('running-plan');
  });

  it('校验 step detail 仅包含来源摘要和 ref', () => {
    const parsed = aiAgentStepDetailSchema.parse({
      runId: 'run-1',
      stepId: 'step-1',
      updatedAt: '2026-04-29T10:00:00.000Z',
      webSources: [{
        id: 'web-source-1',
        title: 'Tauri Docs',
        url: 'https://tauri.app/start/',
        sourceType: 'docs',
        status: 'fetched',
        queryPreview: 'Tauri docs',
        fetchedAt: '2026-04-29T10:00:00.000Z',
        textRef: 'web-text:abc',
        excerpt: '短摘要',
      }],
      toolResults: [{
        id: 'tool-result-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'web_fetch',
        status: 'succeeded',
        summary: '读取 1 个网页正文引用',
        startedAt: '2026-04-29T10:00:00.000Z',
        endedAt: '2026-04-29T10:00:01.000Z',
        outputRef: 'web-text:abc',
      }],
    });

    expect(parsed.webSources[0]?.textRef).toBe('web-text:abc');
  });

  it('校验 timeline item 只保存摘要与 ref', () => {
    const parsed = aiAgentTimelineItemSchema.parse({
      id: 'timeline-tool-1',
      runId: 'run-1',
      stepId: 'step-1',
      type: 'tool-result',
      title: 'web_fetch',
      status: 'succeeded',
      createdAt: '2026-04-29T10:00:01.000Z',
      subtitle: '读取 1 个网页正文引用',
      detailRef: 'web-text:abc',
    });

    expect(parsed.detailRef).toBe('web-text:abc');
    expect(() =>
      aiAgentTimelineItemSchema.parse({
        ...parsed,
        status: 'unknown',
      }),
    ).toThrow();
  });

});
