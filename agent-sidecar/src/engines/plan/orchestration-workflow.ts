import { createWorkflow, createStep } from '@mastra/core/workflows'; // VERIFY-1: 1.37.1 导出路径（应为 '@mastra/core/workflows'）
import { z } from 'zod';

/**
 * Phase 1：用原生 Mastra Workflow 收编 plan→execute→validate→replan 主编排。
 *
 * 设计原则（与「彻底替换」终态对齐，但本阶段零行为变更、可 git revert）：
 * - 每个 step 只委托给 `deps` 暴露的现有逻辑（plan / approve / execute / validate / replan / finish）。
 * - 审批门禁用原生 suspend/resume 取代「跨 HTTP 请求 + planWorkflowStore.suspend」。
 * - 本文件暂不被任何运行路径 import；接线在 Phase 2（server.ts + IPlanOrchestrationDeps 实现）。
 *
 * 需本地 `pnpm build` 核对的 4 个 VERIFY 点见下方注释。
 */

// ---------------------------------------------------------------------------
// 注入接口：Phase 2 由 MastraRuntime 实现（内部仍调用现有 store / 现有 phase 方法）
// ---------------------------------------------------------------------------
export interface IPlanOrchestrationDeps {
	generatePlan(input: { goal: string; threadId: string | null }): Promise<{
		planId: string;
		version: number;
		threadId: string;
		stepIds: string[];
	}>;
	approvePlan(input: { planId: string; version: number }): Promise<void>;
	rejectPlan(input: { planId: string; version: number; reason?: string }): Promise<void>;
	/** 执行单个 step；映射到现有 execute()。'suspended' 表示工具审批等外部等待（Phase 2 冒泡为 workflow 级 suspend）。 */
	executeStep(input: { planId: string; version: number; stepId: string }): Promise<{
		status: 'completed' | 'failed' | 'suspended';
		error?: string;
	}>;
	validate(input: { planId: string; version: number }): Promise<{
		needsReplan: boolean;
		summary: string;
	}>;
	/** 生成新版本计划（delta 应用后），返回新 version + 新 stepIds。 */
	replan(input: { planId: string; version: number }): Promise<{
		planId: string;
		version: number;
		stepIds: string[];
	}>;
	finish(input: { planId: string; version: number; status: 'completed' | 'failed' }): Promise<void>;
}

export const PLAN_ORCHESTRATION_WORKFLOW_ID = 'calamex-plan-orchestration';

// 在步骤之间流转的统一上下文（每个 step 的 output 即下个 step 的 input）
const cycleContextSchema = z.object({
	planId: z.string().min(1),
	version: z.number().int().positive(),
	threadId: z.string().min(1),
	stepIds: z.array(z.string().min(1)),
	cursor: z.number().int().nonnegative(), // 下一个待执行 step 的下标
	rejected: z.boolean(),
	validationPassed: z.boolean(),
	lastSummary: z.string().nullable(),
});
type TCycleContext = z.infer<typeof cycleContextSchema>;

const workflowInputSchema = z.object({
	goal: z.string().min(1),
	threadId: z.string().min(1).nullable(),
});
const workflowOutputSchema = z.object({
	planId: z.string().min(1),
	version: z.number().int().positive(),
	finalStatus: z.enum(['completed', 'failed', 'rejected']),
	summary: z.string().nullable(),
});

// resume 时前端回填的审批决定
const approvalResumeSchema = z.object({
	decision: z.enum(['approve', 'reject']),
	reason: z.string().min(1).optional(),
});

export const createPlanOrchestrationWorkflow = (deps: IPlanOrchestrationDeps) => {
	const generatePlanStep = createStep({
		id: 'generate-plan',
		inputSchema: workflowInputSchema,
		outputSchema: cycleContextSchema,
		execute: async ({ inputData }) => {
			const plan = await deps.generatePlan({
				goal: inputData.goal,
				threadId: inputData.threadId,
			});
			return {
				...plan,
				cursor: 0,
				rejected: false,
				validationPassed: false,
				lastSummary: null,
			} satisfies TCycleContext;
		},
	});

	const approvalGateStep = createStep({
		id: 'approval-gate',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
		resumeSchema: approvalResumeSchema,
		// VERIFY-2: suspend() 的 payload 即 resume 前下发给前端的数据；resumeData 由 run.resume({ resumeData }) 注入
		execute: async ({ inputData, resumeData, suspend }) => {
			if (!resumeData) {
				await suspend({
					reason: 'plan_approval',
					planId: inputData.planId,
					version: inputData.version,
				});
				return inputData; // 挂起后此返回值不被消费
			}
			if (resumeData.decision === 'reject') {
				await deps.rejectPlan({
					planId: inputData.planId,
					version: inputData.version,
					...(resumeData.reason ? { reason: resumeData.reason } : {}),
				});
				return { ...inputData, rejected: true };
			}
			await deps.approvePlan({ planId: inputData.planId, version: inputData.version });
			return inputData;
		},
	});

	// 执行单个 step，推进 cursor。.dountil 循环直到 cursor 越过末尾或被拒/失败。
	const executeStepStep = createStep({
		id: 'execute-step',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
		execute: async ({ inputData }) => {
			if (inputData.rejected || inputData.cursor >= inputData.stepIds.length) {
				return inputData;
			}
			const stepId = inputData.stepIds[inputData.cursor]!;
			const result = await deps.executeStep({
				planId: inputData.planId,
				version: inputData.version,
				stepId,
			});
			// VERIFY-3: 'suspended'（工具审批）在 Phase 2 需冒泡为 workflow 级 suspend；
			// Phase 1 先按「已推进」处理以保证骨架可编译 / 可跑通 happy path。
			if (result.status === 'failed') {
				return { ...inputData, validationPassed: false, lastSummary: result.error ?? '执行失败' };
			}
			return { ...inputData, cursor: inputData.cursor + 1 };
		},
	});

	const validateStep = createStep({
		id: 'validate',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
		execute: async ({ inputData }) => {
			if (inputData.rejected) return inputData;
			const report = await deps.validate({ planId: inputData.planId, version: inputData.version });
			return { ...inputData, validationPassed: !report.needsReplan, lastSummary: report.summary };
		},
	});

	const replanStep = createStep({
		id: 'replan',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
		execute: async ({ inputData }) => {
			const next = await deps.replan({ planId: inputData.planId, version: inputData.version });
			return { ...inputData, version: next.version, stepIds: next.stepIds, cursor: 0 };
		},
	});

	const passThroughStep = createStep({
		id: 'validation-passed',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
		execute: async ({ inputData }) => inputData,
	});

	const finishStep = createStep({
		id: 'finish',
		inputSchema: cycleContextSchema,
		outputSchema: workflowOutputSchema,
		execute: async ({ inputData }) => {
			const finalStatus = inputData.rejected
				? ('rejected' as const)
				: inputData.validationPassed
					? ('completed' as const)
					: ('failed' as const);
			if (!inputData.rejected) {
				await deps.finish({
					planId: inputData.planId,
					version: inputData.version,
					status: finalStatus === 'completed' ? 'completed' : 'failed',
				});
			}
			return {
				planId: inputData.planId,
				version: inputData.version,
				finalStatus,
				summary: inputData.lastSummary,
			};
		},
	});

	// 一轮「执行→验证→（需要则重规划）」。外层 .dountil 循环直到验证通过或被拒。
	const executeValidateCycle = createWorkflow({
		id: 'calamex-plan-execute-cycle',
		inputSchema: cycleContextSchema,
		outputSchema: cycleContextSchema,
	})
		// VERIFY-4: .dountil(step, condition) 语义 = 先跑 step，condition 为 true 时停止；条件回调签名 ({ inputData }) => boolean | Promise<boolean>
		.dountil(
			executeStepStep,
			async ({ inputData }) => inputData.rejected || inputData.cursor >= inputData.stepIds.length,
		)
		.then(validateStep)
		.branch([
			[async ({ inputData }) => !inputData.rejected && !inputData.validationPassed, replanStep],
			[async ({ inputData }) => inputData.rejected || inputData.validationPassed, passThroughStep],
		])
		.commit();

	return createWorkflow({
		id: PLAN_ORCHESTRATION_WORKFLOW_ID,
		inputSchema: workflowInputSchema,
		outputSchema: workflowOutputSchema,
	})
		.then(generatePlanStep)
		.then(approvalGateStep)
		.dountil(executeValidateCycle, async ({ inputData }) => inputData.rejected || inputData.validationPassed)
		.then(finishStep)
		.commit();
};
