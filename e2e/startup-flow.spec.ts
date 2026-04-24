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
    __SH_STARTUP_EVENTS__?: IStartupEventSnapshot[];
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__SH_STARTUP_EVENTS__ = [];
  });
});

test('启动流程不会出现空白帧，并完成 welcome handoff', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('welcome-route')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('workbench-root')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('welcome-route')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('startup-veil')).toHaveCount(0);
  await expect(page.getByTestId('app-content-entry')).toHaveClass(/is-visible/);

  const { events } = await page.evaluate(() => ({
    events: window.__SH_STARTUP_EVENTS__ ?? [],
  }));

  expect(events.length).toBeGreaterThan(0);

  const eventNames = events.map((entry) => entry.name);

  expect(eventNames).toContain('workbench-view-ready');
  expect(eventNames).toContain('app-ready-dispatched');
  expect(eventNames).toContain('app-content-visible');
  expect(eventNames).toContain('startup-veil-hidden');

  const workbenchReadyIndex = eventNames.indexOf('workbench-view-ready');
  const appReadyIndex = eventNames.indexOf('app-ready-dispatched');
  const appContentVisibleIndex = eventNames.indexOf('app-content-visible');
  const veilHiddenIndex = eventNames.indexOf('startup-veil-hidden');

  expect(workbenchReadyIndex).toBeGreaterThanOrEqual(0);
  expect(appReadyIndex).toBeGreaterThan(workbenchReadyIndex);
  expect(appContentVisibleIndex).toBeGreaterThan(appReadyIndex);
  expect(veilHiddenIndex).toBeGreaterThan(appContentVisibleIndex);
});
