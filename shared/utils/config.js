const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function requireConfig(names) {
  const missing = names.filter(name => !process.env[name]?.trim());
  if (missing.length) {
    const error = new Error(`Missing configuration: ${missing.join(', ')}. Copy .env.example to .env and fill in these values.`);
    error.status = 503;
    throw error;
  }
}

function validateIssueKey(key) {
  if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(key)) {
    const error = new Error('A valid issueKey is required, for example SCRUM-6');
    error.status = 400;
    throw error;
  }
  return key;
}

function descriptionText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'hardBreak') return '\n';
  const text = value.text || (value.content || []).map(descriptionText).join('');
  return text + (['paragraph', 'heading', 'listItem'].includes(value.type) ? '\n' : '');
}

function normalizeTestCases(value) {
  const scenarios = Array.isArray(value) ? value : value?.scenarios || value?.testCases;
  if (!Array.isArray(scenarios) || !scenarios.length) throw new Error('Expected a non-empty scenarios or testCases array');
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario.title !== 'string' || !scenario.title.trim()) throw new Error('Every test scenario needs a title');
  }
  return { scenarios };
}

function parseModelJson(message) {
  if (message.stop_reason === 'max_tokens') throw new Error('Claude response was truncated; reduce the ticket scope');
  const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
  return JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}

module.exports = { requireConfig, validateIssueKey, descriptionText, normalizeTestCases, parseModelJson };
