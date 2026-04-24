import type { IAnalyzeScriptPayload } from '@/types/editor';

export type TShellcheckStatusTone = 'ok' | 'error' | 'warning' | 'info';

export interface IShellcheckStatusSummary {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  issueCount: number;
  tone: TShellcheckStatusTone;
  label: string;
}

const formatDiagnosticCount = (
  count: number,
  singular: string,
  plural = `${singular}s`,
): string => `${count} ${count === 1 ? singular : plural}`;

export const resolveShellcheckStatusSummary = (
  analysis: IAnalyzeScriptPayload,
): IShellcheckStatusSummary => {
  const errorCount = analysis.diagnostics.filter((item) => item.level === 'error').length;
  const warningCount = analysis.diagnostics.filter((item) => item.level === 'warning').length;
  const infoCount = analysis.diagnostics.filter(
    (item) => item.level === 'info' || item.level === 'style',
  ).length;
  const issueCount = analysis.diagnostics.length;

  const tone: TShellcheckStatusTone =
    !analysis.available || warningCount > 0
      ? errorCount > 0
        ? 'error'
        : 'warning'
      : errorCount > 0
        ? 'error'
        : infoCount > 0
          ? 'info'
          : 'ok';

  const label =
    !analysis.available
      ? 'ShellCheck unavailable'
      : issueCount === 0
        ? '0 issues'
        : [
            errorCount > 0 ? formatDiagnosticCount(errorCount, 'error') : null,
            warningCount > 0 ? formatDiagnosticCount(warningCount, 'warning') : null,
            infoCount > 0 ? formatDiagnosticCount(infoCount, 'info', 'info') : null,
          ]
            .filter((item): item is string => item !== null)
            .join(' / ');

  return {
    errorCount,
    warningCount,
    infoCount,
    issueCount,
    tone,
    label,
  };
};
