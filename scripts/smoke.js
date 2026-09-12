// Runs real Chromium and checks both passing and failing reporter results, without external services.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { runPlaywrightTests } = require('../agents/agent3-test-executor');

async function main() {
  const root = path.resolve(__dirname, '../work');
  await fs.mkdir(root, { recursive: true });
  const repo = await fs.mkdtemp(path.join(root, 'smoke-'));
  await fs.writeFile(path.join(repo, 'playwright.config.js'), `module.exports = { testDir: '.', retries: 0, workers: 1, use: { headless: true } };`);
  const file = path.join(repo, 'browser.spec.js');
  await fs.writeFile(file, `const { test, expect } = require('@playwright/test');
test.describe('local browser', () => {
  test('renders a login form', async ({ page }) => {
    await page.setContent('<label>Username<input aria-label="Username"></label><button>Log in</button>');
    await page.getByLabel('Username').fill('tester');
    await expect(page.getByLabel('Username')).toHaveValue('tester');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});`);
  const passed = await runPlaywrightTests(repo);
  assert.equal(passed.passed, 1);
  assert.equal(passed.success, true);
  await fs.appendFile(file, `\ntest('intentional failure to check reporting', () => { expect(1).toBe(2); });`);
  const failed = await runPlaywrightTests(repo);
  assert.equal(failed.totalTests, 2);
  assert.equal(failed.passed, 1);
  assert.equal(failed.failed, 1);
  assert.equal(failed.success, false);
  assert.equal(failed.failedTests.length, 1);
  console.log('Browser smoke passed: real Chromium execution and failure reporting verified.');
  console.log(`Reports: ${repo}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
