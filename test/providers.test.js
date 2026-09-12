const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { triggerAgent1 } = require('../agents/agent1-test-creator');
const { generatePlaywrightScript } = require('../agents/agent2-script-generator');
const { getIssue, updateJiraCard } = require('../shared/utils/jira-utils');

test('real SDK generation and Jira REST payloads work against local stubs', async t => {
  const savedEnv = { ...process.env };
  const originalAdapter = axios.defaults.adapter;
  const key = `TEST-${Date.now()}`;
  const testCasePath = path.resolve(__dirname, `../shared/test-cases/${key}-test-cases.json`);
  t.after(async () => {
    axios.defaults.adapter = originalAdapter;
    for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
    Object.assign(process.env, savedEnv);
    await fs.rm(testCasePath, { force: true });
  });
  const requests = [];
  const scenarios = [{ id: 'TC001', title: 'Login', scenario: 'Login', priority: 'High', preconditions: [],
    testSteps: [{ step: 1, action: 'Open login', expectedResult: 'Form appears' }] }];
  const files = [{ path: 'tests/e2e/login.spec.ts', content: 'test("login", () => {});' }];
  let count = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    const content = count++ === 0 ? { scenarios } : { files };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_fixture', type: 'message', role: 'assistant',
      model: 'fixture', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(content) }],
      usage: { input_tokens: 1, output_tokens: 1 } }));
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  Object.assign(process.env, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_API_KEY: 'fixture-key', JIRA_HOST: 'fixture.atlassian.net', JIRA_EMAIL: 'fixture@example.com', JIRA_API_TOKEN: 'fixture-token' });
  const issue = { key, fields: { summary: 'Login', description: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Users can log in' }] }
  ] } } };
  const jiraCalls = [];
  axios.defaults.adapter = async config => {
    jiraCalls.push(config);
    assert.equal(config.baseURL, 'https://fixture.atlassian.net/rest/api/2');
    let data = {};
    if (config.method === 'get' && config.url.endsWith('/transitions')) data = { transitions: [{ id: '31', name: 'Finish', to: { name: 'Done' } }] };
    else if (config.method === 'get') data = issue;
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const fetched = await getIssue(key);
  const created = await triggerAgent1(fetched);
  assert.deepEqual(created.testCases, { scenarios });
  assert.deepEqual(JSON.parse(await fs.readFile(testCasePath, 'utf8')), { scenarios });
  assert.equal(count, 1, 'Agent 1 must not implicitly trigger Agent 2');
  assert.match(requests[0].messages[0].content, /Users can log in/);
  assert.doesNotMatch(requests[0].messages[0].content, /\[object Object\]/);
  assert.deepEqual(await generatePlaywrightScript(created.testCases, 'Existing BasePage API'), files);
  assert.match(requests[1].messages[0].content, /Existing BasePage API/);
  await updateJiraCard(key, { comment: 'Passed', transition: 'DONE' });
  const comment = jiraCalls.find(call => call.url.endsWith('/comment'));
  assert.equal(typeof JSON.parse(comment.data).body, 'string');
  const transition = jiraCalls.find(call => call.method === 'post' && call.url.endsWith('/transitions'));
  assert.deepEqual(JSON.parse(transition.data), { transition: { id: '31' } });
});
