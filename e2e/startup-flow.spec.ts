import { expect, test } from '@playwright/test';

type IStartupEventSnapshot = {
    name: string;
    at: number;
    splashVisible: boolean;
    veilVisible: boolean;
    appVisible: boolean;
};

declare global {
    interface Window {
        __SH_SAW_BOOTSTRAP__?: boolean;
        __SH_STARTUP_EVENTS__?: IStartupEventSnapshot[];
    }
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const markBootstrapPresence = (): void => {
            if (document.getElementById('bootstrap-splash')) {
                window.__SH_SAW_BOOTSTRAP__ = true;
            }
        };

        window.__SH_SAW_BOOTSTRAP__ = false;
        window.__SH_STARTUP_EVENTS__ = [];

        document.addEventListener('DOMContentLoaded', markBootstrapPresence, { once: true });

        new MutationObserver(markBootstrapPresence).observe(document.documentElement, {
            subtree: true,
            childList: true,
        });

        window.requestAnimationFrame(markBootstrapPresence);
    });
});

test('启动流程不会出现空白帧，并完成 splash handoff', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('workbench-root')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('splash-screen')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#bootstrap-splash')).toHaveCount(0);
    await expect(page.getByTestId('startup-veil')).toHaveCount(0);
    await expect(page.getByTestId('app-content-entry')).toHaveClass(/is-visible/);

    const { sawBootstrap, events } = await page.evaluate(() => ({
        sawBootstrap: window.__SH_SAW_BOOTSTRAP__ ?? false,
        events: window.__SH_STARTUP_EVENTS__ ?? [],
    }));

    expect(sawBootstrap).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);

    const eventNames = events.map((entry) => entry.name);

    expect(eventNames).toContain('workbench-view-ready');
    expect(eventNames).toContain('splash-leave-start');
    expect(eventNames).toContain('splash-after-leave');
    expect(eventNames).toContain('app-content-visible');
    expect(eventNames).toContain('startup-veil-hidden');

    const workbenchReadyIndex = eventNames.indexOf('workbench-view-ready');
    const splashLeaveStartIndex = eventNames.indexOf('splash-leave-start');
    const splashAfterLeaveIndex = eventNames.indexOf('splash-after-leave');
    const appContentVisibleIndex = eventNames.indexOf('app-content-visible');
    const veilHiddenIndex = eventNames.indexOf('startup-veil-hidden');

    expect(workbenchReadyIndex).toBeGreaterThanOrEqual(0);
    expect(splashLeaveStartIndex).toBeGreaterThan(workbenchReadyIndex);
    expect(splashAfterLeaveIndex).toBeGreaterThanOrEqual(splashLeaveStartIndex);
    expect(appContentVisibleIndex).toBeGreaterThan(splashAfterLeaveIndex);
    expect(veilHiddenIndex).toBeGreaterThan(appContentVisibleIndex);
});