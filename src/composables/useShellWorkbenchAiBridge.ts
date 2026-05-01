import { ref, type Ref } from 'vue';

import type { IAiCodeActionRequest } from '@/types/ai';
import type { IScriptDiagnostic } from '@/types/editor';

export type TTitlebarExpose = {
    openCommandPalette: () => void;
};

export type TRunPanelExpose = {
    openShellCheck: () => void;
};

type TAiCodeActionEditorExpose = {
    runAiCodeAction: (kind: IAiCodeActionRequest['kind']) => void | Promise<void>;
};

interface IUseShellWorkbenchAiBridgeOptions {
    editorRef: Ref<unknown>;
    openTerminal: () => Promise<void>;
    handleSelectDiagnostic: (line: number, column: number) => void;
}

export const useShellWorkbenchAiBridge = (options: IUseShellWorkbenchAiBridgeOptions) => {
    const titlebarRef = ref<TTitlebarExpose | null>(null);
    const runPanelRef = ref<TRunPanelExpose | null>(null);

    const getAiCodeActionEditor = (): TAiCodeActionEditorExpose | null => {
        const candidate = options.editorRef.value as Partial<TAiCodeActionEditorExpose> | null | undefined;

        if (typeof candidate?.runAiCodeAction !== 'function') {
            return null;
        }

        return candidate as TAiCodeActionEditorExpose;
    };

    const runAiCodeAction = (kind: IAiCodeActionRequest['kind']): void => {
        void getAiCodeActionEditor()?.runAiCodeAction(kind);
    };

    const handleOpenCommandPalette = (): void => {
        titlebarRef.value?.openCommandPalette();
    };

    const handleAiCodeAction = (kind: IAiCodeActionRequest['kind']): void => {
        runAiCodeAction(kind);
    };

    const handleAiFixDiagnostic = (diagnostic: IScriptDiagnostic): void => {
        options.handleSelectDiagnostic(diagnostic.line, diagnostic.column);
        runAiCodeAction('fix_diagnostic');
    };

    const handleOpenShellCheck = async (): Promise<void> => {
        await options.openTerminal();
        runPanelRef.value?.openShellCheck();
    };

    return {
        titlebarRef,
        runPanelRef,
        handleOpenCommandPalette,
        handleAiCodeAction,
        handleAiFixDiagnostic,
        handleOpenShellCheck,
    };
};
