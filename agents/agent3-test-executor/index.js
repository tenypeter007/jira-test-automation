const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { requireConfig, validateIssueKey } = require('../../shared/utils/config');
const { cloneRepository, getPullRequest } = require('../../shared/utils/repository');
const { updateJiraCard } = require('../../shared/utils/jira-utils');

async function runNode(cli, args, cwd, env = process.env) {
  return execute(process.execPath, [cli, ...args], {
    cwd, env, windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024
  });
}

function parseReport(report) {
  if (!Array.isArray(report.suites)) throw new Error('Invalid Playwright report: missing suites');
  if (report.errors?.length) throw new Error(`Playwright run error: ${report.errors.map(e => e.message).join('; ')}`);
  const result = { totalTests: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, failedTests: [] };
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        result.totalTests++;
        if (test.status === 'skipped') result.skipped++;
        else if (test.status === 'expected' || test.status === 'flaky') {
          result.passed++;
          if (test.status === 'flaky') result.flaky++;
        } else {
          result.failed++;
          const last = test.results?.at(-1);
          result.failedTests.push({ name: spec.title, file: spec.file, project: test.projectName,
            error: last?.error?.message || last?.errors?.map(e => e.message).join('\n') || 'Test did not complete' });
        }
      }
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  if (!result.totalTests || result.totalTests === result.skipped) throw new Error('No tests executed (empty or entirely skipped suite)');
  result.success = result.failed === 0;
  return result;
}

async function runPlaywrightTests(repoDir, headedMode = false) {
  const cli = require.resolve('@playwright/test/cli', { paths: [repoDir] });
  const reportPath = path.join(repoDir, 'automation-results.json');
  await fs.rm(reportPath, { force: true });
  let runError;
  try {
    await runNode(cli, ['test', '--forbid-only', '--reporter=html,json', ...(headedMode ? ['--headed'] : [])], repoDir, {
      ...process.env, CI: '1', HEADED: String(headedMode), PLAYWRIGHT_HTML_OPEN: 'never',
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
      PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(repoDir, 'playwright-report')
    });
  } catch (error) { runError = error; }
  if (runError && (runError.killed || runError.code !== 1)) throw new Error(`Playwright process failed: ${runError.message}`);
  let report;
  try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
  catch { throw new Error(`Playwright did not produce a valid JSON report${runError ? `: ${runError.stderr || runError.message}` : ''}`); }
  const results = parseReport(report);
  if (runError && results.failed === 0) throw new Error('Playwright exited unsuccessfully despite passing test entries');
  return { ...results, reportPath, htmlReportPath: path.join(repoDir, 'playwright-report/index.html') };
}

async function triggerAgent3(issue, generated) {
  validateIssueKey(issue?.key);
  requireConfig(['TARGET_REPO_URL', 'GITHUB_TOKEN', 'JIRA_HOST', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  const prUrl = typeof generated === 'string' ? generated : generated?.prUrl;
  const pr = await getPullRequest(prUrl);
  const expectedSha = typeof generated === 'object' ? generated.commitSha : pr.head.sha;
  if (!/^[a-f0-9]{40}$/.test(expectedSha || '') || pr.head.sha !== expectedSha) throw new Error('The PR changed after generation; run Agent 3 again for the current PR');
  const { repoDir, git } = await cloneRepository(`${issue.key}-execute-`);
  await git.fetch('origin', `refs/pull/${pr.number}/head`);
  const fetchedSha = (await git.revparse(['FETCH_HEAD'])).trim();
  if (fetchedSha !== expectedSha) throw new Error('PR head changed while fetching tests');
  await git.checkout(expectedSha);

  const targetPackage = JSON.parse(await fs.readFile(path.join(repoDir, 'package.json'), 'utf8'));
  if (!targetPackage.dependencies?.['@playwright/test'] && !targetPackage.devDependencies?.['@playwright/test']) {
    throw new Error('The target repository must declare @playwright/test in package.json');
  }

  const npmCli = process.env.npm_execpath;
  const lockExists = await fs.access(path.join(repoDir, 'package-lock.json')).then(() => true, () => false);
  const installArgs = [lockExists ? 'ci' : 'install', '--include=dev', '--no-audit', '--no-fund'];
  if (npmCli) await runNode(npmCli, installArgs, repoDir);
  else if (process.platform === 'win32') {
    // Only fixed arguments go through cmd; no paths or request input are interpolated.
    await execute('cmd.exe', ['/d', '/s', '/c', `npm.cmd ${installArgs.join(' ')}`], {
      cwd: repoDir, windowsHide: true, timeout: 900000, maxBuffer: 20 * 1024 * 1024
    });
  } else await execute('npm', installArgs, { cwd: repoDir, timeout: 900000, maxBuffer: 20 * 1024 * 1024 });
  const cli = require.resolve('@playwright/test/cli', { paths: [repoDir] });
  await runNode(cli, ['install'], repoDir);
  const start = Date.now();
  const results = await runPlaywrightTests(repoDir, process.env.HEADED === 'true');
  results.durationSeconds = Math.round((Date.now() - start) / 1000);
  results.prUrl = prUrl;
  results.commitSha = expectedSha;
  const transition = results.success ? process.env.JIRA_SUCCESS_STATUS : process.env.JIRA_FAILURE_STATUS;
  await updateJiraCard(issue.key, {
    comment: `Agent 3: ${results.success ? 'PASSED' : 'FAILED'}\nPassed: ${results.passed}; Failed: ${results.failed}; Skipped: ${results.skipped}; Flaky: ${results.flaky}\nDuration: ${results.durationSeconds}s\nTest PR: ${prUrl}\nCommit: ${expectedSha}`,
    ...(transition ? { transition } : {})
  });
  return results;
}

module.exports = { triggerAgent3, runPlaywrightTests, parseReport };
