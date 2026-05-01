import { z } from 'zod';

export const agentPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped', 'cancelled']),
  tools: z.array(z.string().min(1)),
  riskLevel: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  expectedOutput: z.string().min(1),
});

export const agentPlanSchema = z.object({
  goal: z.string().min(1),
  steps: z.array(agentPlanStepSchema).min(1),
});

export type TAgentPlan = z.infer<typeof agentPlanSchema>;
export type TAgentPlanStep = z.infer<typeof agentPlanStepSchema>;
