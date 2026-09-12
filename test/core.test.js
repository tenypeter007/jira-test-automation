const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRunner, createApp } = require('../server');
const { validateIssueKey, descriptionText, normalizeTestCases, parseModelJson } = require('../shared/utils/config');
const { validateFiles, repositoryInfo } = require('../shared/utils/repository');
const { parseReport } = require('../agents/agent3-test-executor');

test('Jira descriptions support text and Atlassian documents', () => {
  assert.equal(descriptionText('Plain text'), 'Plain text');
  assert.equal(descriptionText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Login' }] }] }), 'Login\n');
  assert.equal(descriptionText(null), '');
});

test('issue keys reject traversal and missing values', () => {
  assert.equal(validateIssueKey('SCRUM-6'), 'SCRUM-6');
  for (const key of [null, '', '../secret', 'SCRUM-0', 'SCRUM-1/../../x']) assert.throws(() => validateIssueKey(key));
});

test('both persisted test case schemas normalize without losing scenarios', () => {
  const scenarios = [{ title: 'Login' }];
  for (const input of [{ scenarios }, { testCases: scenarios }, scenarios]) assert.deepEqual(normalizeTestCases(input), { scenarios });
  assert.throws(() => normalizeTestCases({ scenarios: [] }));
});

test('model JSON supports fenced text and rejects truncation', () => {
  assert.deepEqual(parseModelJson({ content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }] }), { ok: true });
  assert.throws(() => parseModelJson({ stop_reason: 'max_tokens', content: [] }), /truncated/);
});

test('generated paths cannot escape the tests directories or overwrite framework files', () => {
  const spec = { path: 'tests/e2e/login.spec.ts', content: 'test("login", () => {});' };
  assert.deepEqual(validateFiles([spec]), [spec]);
  for (const name of ['tests/pages/../../server.js', 'tests/pages/BasePage.ts', 'tests/e2e/../../.git/config', 'C:\\secret.ts', 'tests/pages/x.js']) {
    assert.throws(() => validateFiles([spec, { path: name, content: 'x' }]));
  }
  assert.throws(() => validateFiles([spec, spec]));
  assert.throws(() => validateFiles([{ ...spec, content: 'test.only("x", () => {});' }]));
  assert.throws(() => validateFiles([]));
});

test('repository URLs are parsed and credentials cannot be embedded', () => {
  assert.equal(repositoryInfo('https://github.com/owner/repo.git').repo, 'repo');
  assert.equal(repositoryInfo('https://github.com/owner/repo/').repo, 'repo');
  for (const url of ['http://github.com/a/b', 'https://token@github.com/a/b', 'https://evil.example/a/b']) assert.throws(() => repositoryInfo(url));
});

function report(statuses) {
  return { suites: [{ suites: [{ specs: statuses.map(status => ({ title: status, file: 'tests/a.spec.ts', tests: [{ status, results: [{ error: { message: 'Failure' } }] }] })) }] }] };
}

test('Playwright nested suites count projects, skips, retries and failures', () => {
  const result = parseReport(report(['expected', 'unexpected', 'skipped', 'flaky']));
  assert.equal(result.totalTests, 4);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.flaky, 1);
  assert.equal(result.success, false);
  assert.equal(result.failedTests[0].error, 'Failure');
});

test('missing, empty, skipped and global-error reports cannot pass', () => {
  for (const value of [{}, report([]), report(['skipped']), { ...report(['expected']), errors: [{ message: 'Setup failed' }] }]) assert.throws(() => parseReport(value));
});

test('full pipeline calls each agent once and carries the exact generated commit', async () => {
  const calls = [];
  const issue = { key: 'SCRUM-6', fields: { summary: 'Login' } };
  const testCases = { scenarios: [{ title: 'Login' }] };
  const generated = { prUrl: 'https://github.com/a/b/pull/1', commitSha: 'abc' };
  const run = createRunner({
    getIssue: async key => { assert.equal(key, issue.key); return issue; },
    triggerAgent1: async input => { calls.push(1); assert.equal(input, issue); return { testCases }; },
    triggerAgent2: async (input, cases) => { calls.push(2); assert.equal(cases, testCases); return generated; },
    triggerAgent3: async (input, code) => { calls.push(3); assert.equal(code, generated); return { success: true }; }
  });
  assert.equal((await run(issue.key)).success, true);
  assert.deepEqual(calls, [1, 2, 3]);
});

test('generation errors stop execution and propagate', async () => {
  const run = createRunner({ getIssue: async () => ({ key: 'SCRUM-6' }),
    triggerAgent1: async () => ({ testCases: {} }),
    triggerAgent2: async () => { throw new Error('Generation failed'); },
    triggerAgent3: async () => assert.fail('Executor must not run') });
  await assert.rejects(run('SCRUM-6'), /Generation failed/);
});

async function withServer(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (url, body) => fetch(base + url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('HTTP health works without credentials and invalid inputs are rejected', async t => {
  const request = await withServer(t, { validateConfig: () => {}, run: async () => ({}) });
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/generate-tests', {})).status, 400);
  assert.equal((await request('/agent/3', { issueKey: 'SCRUM-6' })).status, 400);
  assert.equal((await request('/agent/9', { issueKey: 'SCRUM-6' })).status, 400);
});

test('HTTP failures remain visible through job status', async t => {
  const request = await withServer(t, { validateConfig: () => {}, run: async () => { throw new Error('Provider unavailable'); } });
  const response = await request('/generate-tests', { issueKey: 'SCRUM-6' });
  assert.equal(response.status, 202);
  const job = await response.json();
  const status = await (await request(job.statusUrl)).json();
  assert.equal(status.status, 'failed');
  assert.match(status.error, /Provider unavailable/);
});

test('failed test results mark the HTTP job failed', async t => {
  const request = await withServer(t, { validateConfig: () => {}, run: async () => ({ success: false, failed: 1 }) });
  const job = await (await request('/generate-tests', { issueKey: 'SCRUM-6' })).json();
  const status = await (await request(job.statusUrl)).json();
  assert.equal(status.status, 'failed');
  assert.equal(status.result.failed, 1);
});

test('configuration failures are returned before accepting a job', async t => {
  const request = await withServer(t, { validateConfig: () => { throw Object.assign(new Error('Missing configuration'), { status: 503 }); }, run: async () => assert.fail() });
  assert.equal((await request('/generate-tests', { issueKey: 'SCRUM-6' })).status, 503);
});

test('configured API bearer token protects job routes but not health', async t => {
  const oldToken = process.env.API_TOKEN;
  process.env.API_TOKEN = 'local-test-token';
  t.after(() => { if (oldToken === undefined) delete process.env.API_TOKEN; else process.env.API_TOKEN = oldToken; });
  const request = await withServer(t, { validateConfig: () => {}, run: async () => ({}) });
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/jobs/unknown')).status, 401);
});

test('duplicate active issues are rejected and comment webhooks do not loop', async t => {
  let finish;
  const request = await withServer(t, { validateConfig: () => {}, run: () => new Promise(resolve => { finish = resolve; }) });
  const response = await request('/agents/all', { issueKey: 'SCRUM-6' });
  assert.equal(response.status, 202);
  assert.equal((await request('/agents/all', { issueKey: 'SCRUM-6' })).status, 409);
  const ignored = await (await request('/jira-webhook', { webhookEvent: 'jira:issue_updated', issue: { key: 'SCRUM-6' }, changelog: { items: [{ field: 'comment' }] } })).json();
  assert.equal(ignored.status, 'ignored');
  finish({ success: true });
});
