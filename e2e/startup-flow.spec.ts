import { expect, test } from '@playwright/test';

test('启动后直接进入工作台且没有 welcome 遗留节点', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('workbench-root')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('startup-veil')).toHaveCount(0);
  await expect(page.getByTestId('welcome-window')).toHaveCount(0);
});
