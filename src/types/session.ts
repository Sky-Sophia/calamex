import { z } from 'zod';
import { WORKBENCH_SIDEBAR_VIEWS } from '@/types/app';

/** Monaco 视图态是黑盒结构，这里仅做 JSON object 守卫。 */
export const MonacoViewStateSchema = z.record(z.string(), z.unknown());
export const SessionTabKindSchema = z.enum(['text', 'image']);
export const SessionWorkbenchSidebarViewSchema = z.enum(WORKBENCH_SIDEBAR_VIEWS);

export const TabStateSchema = z.object({
  path: z.string().min(1),
  pinned: z.boolean().default(false),
  order: z.number().int().nonnegative(),
  kind: SessionTabKindSchema.optional(),
});

export const EditorViewStateEntrySchema = z.object({
  path: z.string().min(1),
  viewState: MonacoViewStateSchema,
  updatedAt: z.string().datetime(),
});

export const SessionWorkbenchStateSchema = z.object({
  activeSidebarView: SessionWorkbenchSidebarViewSchema.default('explorer'),
  explorerExpandedPaths: z.array(z.string().min(1)).max(120).default([]),
  explorerSelectedPath: z.string().nullable().default(null),
  isTerminalVisible: z.boolean().default(true),
}).default({
  activeSidebarView: 'explorer',
  explorerExpandedPaths: [],
  explorerSelectedPath: null,
  isTerminalVisible: true,
});

export const SessionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceRoot: z.string().nullable(),
  openTabs: z.array(TabStateSchema).max(30),
  activeTabPath: z.string().nullable(),
  viewStates: z.array(EditorViewStateEntrySchema).max(30),
  workbench: SessionWorkbenchStateSchema,
  recentWorkspaces: z.array(z.string()).max(10),
  recentFiles: z.array(z.string()).max(50),
  savedAt: z.string().datetime(),
});

export type TSessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type TTabState = z.infer<typeof TabStateSchema>;
export type TSessionTabKind = z.infer<typeof SessionTabKindSchema>;
export type TSessionWorkbenchState = z.infer<typeof SessionWorkbenchStateSchema>;
