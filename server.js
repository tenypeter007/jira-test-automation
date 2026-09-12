const { requireConfig, validateIssueKey, normalizeTestCases } = require('./shared/utils/config');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { getIssue } = require('./shared/utils/jira-utils');
const { triggerAgent1 } = require('./agents/agent1-test-creator');
const { triggerAgent2 } = require('./agents/agent2-script-generator');
const { triggerAgent3 } = require('./agents/agent3-test-executor');

function checkConfig(agent) {
  requireConfig(['JIRA_HOST', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
  if (agent !== '3') requireConfig(['ANTHROPIC_API_KEY']);
  if (agent !== '1') requireConfig(['TARGET_REPO_URL', 'GITHUB_TOKEN']);
}

function createRunner(deps = {}) {
  const api = { getIssue, triggerAgent1, triggerAgent2, triggerAgent3, ...deps };
  return async (key, agent = 'all', prUrl) => {
    validateIssueKey(key);
    if (!['1', '2', '3', 'all'].includes(agent)) throw Object.assign(new Error('Unknown agent'), { status: 400 });
    const issue = await api.getIssue(key);
    if (agent === '1') return api.triggerAgent1(issue);
    if (agent === '3') return api.triggerAgent3(issue, prUrl);
    let testCases;
    if (agent === 'all') ({ testCases } = await api.triggerAgent1(issue));
    else {
      const file = path.join(__dirname, 'shared/test-cases', `${key}-test-cases.json`);
      testCases = normalizeTestCases(JSON.parse(await fs.readFile(file, 'utf8')));
    }
    const generated = await api.triggerAgent2(issue, testCases);
    if (agent === '2') return generated;
    return api.triggerAgent3(issue, generated);
  };
}

function createApp({ run = createRunner(), validateConfig = checkConfig } = {}) {
  const app = express();
  const jobs = new Map();
  const active = new Set();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/', (_req, res) => res.json({ service: 'Jira Test Automation', status: 'running' }));
  app.get('/health', (_req, res) => res.json({ status: 'healthy', uptime: process.uptime() }));
  app.use((req, res, next) => {
    if (!process.env.API_TOKEN) return next();
    const expected = Buffer.from(`Bearer ${process.env.API_TOKEN}`);
    const actual = Buffer.from(req.get('authorization') || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });
  function submit(req, res, agent, key) {
    validateIssueKey(key);
    if (!['1', '2', '3', 'all'].includes(agent)) throw Object.assign(new Error('Unknown agent'), { status: 400 });
    if (agent === '3' && !req.body?.prUrl) throw Object.assign(new Error('prUrl is required for Agent 3'), { status: 400 });
    validateConfig(agent);
    if (active.has(key)) return res.status(409).json({ error: `A job for ${key} is already running` });
    if (active.size >= 4) return res.status(429).json({ error: 'All workers are busy; retry later' });
    const job = { id: randomUUID(), issueKey: key, agent, status: 'queued', createdAt: new Date().toISOString() };
    if (jobs.size >= 100) {
      const oldest = [...jobs].find(([, item]) => !['queued', 'running'].includes(item.status));
      if (oldest) jobs.delete(oldest[0]);
    }
    jobs.set(job.id, job);
    active.add(key);
    res.status(202).json({ ...job, statusUrl: `/jobs/${job.id}` });
    Promise.resolve().then(async () => {
      job.status = 'running';
      job.result = await run(key, agent, req.body?.prUrl);
      job.status = job.result?.success === false ? 'failed' : 'completed';
    }).catch(error => {
      job.status = 'failed';
      job.error = error.message;
    }).finally(() => {
      job.finishedAt = new Date().toISOString();
      active.delete(key);
    });
  }
  app.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found (jobs are kept in memory)' });
    res.json(job);
  });
  app.post(['/generate-tests', '/agents/all'], (req, res) => submit(req, res, 'all', req.body?.issueKey));
  app.post(['/agent/:agent', '/agents/:agent'], (req, res) => submit(req, res, req.params.agent, req.body?.issueKey));
  app.post('/jira-webhook', (req, res) => {
    const payload = req.body || {};
    const relevantUpdate = payload.webhookEvent === 'jira:issue_updated' &&
      payload.changelog?.items?.some(item => ['summary', 'description'].includes(item.field));
    if (payload.webhookEvent !== 'jira:issue_created' && !relevantUpdate) {
      return res.json({ status: 'ignored', reason: 'Only issue creation or summary/description changes trigger tests' });
    }
    submit(req, res, 'all', payload.issue?.key);
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

async function main(args = process.argv.slice(2)) {
  if (args.length) {
    const issueIndex = args.indexOf('--issue');
    const agentIndex = args.indexOf('--agent');
    const prIndex = args.indexOf('--pr');
    if (issueIndex < 0) throw new Error('Usage: npm start -- --issue SCRUM-6 [--agent 1|2|3|all] [--pr URL]');
    const key = validateIssueKey(args[issueIndex + 1]);
    const agent = agentIndex < 0 ? 'all' : args[agentIndex + 1];
    checkConfig(agent);
    const result = await createRunner()(key, agent, prIndex < 0 ? undefined : args[prIndex + 1]);
    console.log(JSON.stringify(result, null, 2));
    if (result?.success === false) process.exitCode = 1;
    return;
  }
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) requireConfig(['API_TOKEN']);
  const port = Number(process.env.PORT || 3000);
  const server = createApp().listen(port, host, () => console.log(`Server running on http://${host}:${server.address().port}`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createApp, createRunner, main };
