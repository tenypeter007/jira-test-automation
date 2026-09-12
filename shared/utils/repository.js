const fs = require('node:fs/promises');
const path = require('node:path');
const simpleGit = require('simple-git');
const axios = require('axios');
const { requireConfig } = require('./config');

function repositoryInfo(repoUrl = process.env.TARGET_REPO_URL) {
  let url;
  try { url = new URL(repoUrl); } catch { throw new Error('TARGET_REPO_URL must be an HTTPS GitHub repository URL'); }
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username || url.password || url.search || url.hash || !match) {
    throw new Error('TARGET_REPO_URL must be https://github.com/owner/repository.git');
  }
  const [, owner, repo] = match;
  return { owner, repo, url: `https://github.com/${owner}/${repo}.git`, api: `https://api.github.com/repos/${owner}/${repo}` };
}

function githubHeaders() {
  requireConfig(['GITHUB_TOKEN']);
  return { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
}

async function cloneRepository(prefix) {
  const info = repositoryInfo();
  const root = path.resolve(__dirname, '../../temp-repo');
  await fs.mkdir(root, { recursive: true });
  const repoDir = await fs.mkdtemp(path.join(root, prefix));
  // Supply auth only to Git's process environment, never in the remote URL or .git/config.
  const auth = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64');
  const git = simpleGit(repoDir).env({ ...process.env, GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}` });
  await git.clone(info.url, '.');
  await git.addConfig('user.name', 'Jira Automation');
  await git.addConfig('user.email', 'jira-automation@users.noreply.github.com');
  return { git, repoDir, info };
}

function validateFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('Claude must return a non-empty files array');
  const seen = new Set();
  for (const file of files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string' || !file.content.trim() ||
        !/^(?:tests\/pages\/[A-Za-z0-9_-]+\.ts|tests\/(?:e2e|ui|visual)\/[A-Za-z0-9_-]+\.spec\.ts|tests\/testdata\.ts)$/.test(file.path) ||
        file.path === 'tests/pages/BasePage.ts' || seen.has(file.path)) {
      throw new Error(`Invalid or duplicate generated file: ${file?.path}`);
    }
    if (/\b(?:test|describe)\s*\.\s*only\s*\(/.test(file.content)) throw new Error('Generated tests must not contain .only()');
    seen.add(file.path);
  }
  if (!files.some(file => file.path.endsWith('.spec.ts'))) throw new Error('Claude must generate at least one test spec');
  return files;
}

async function writeGeneratedFiles(repoDir, files) {
  validateFiles(files);
  for (const file of files) {
    // Reject symlinks from the target checkout, including ancestor directories.
    let current = repoDir;
    for (const segment of file.path.split('/')) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      if (stat?.isSymbolicLink()) throw new Error(`Refusing symlink: ${file.path}`);
    }
    await fs.mkdir(path.dirname(current), { recursive: true });
    await fs.writeFile(current, file.content);
  }
}

async function getPullRequest(prUrl) {
  const info = repositoryInfo();
  const prefix = `https://github.com/${info.owner}/${info.repo}/pull/`;
  if (typeof prUrl !== 'string' || !prUrl.startsWith(prefix) || !/^[1-9][0-9]*$/.test(prUrl.slice(prefix.length))) {
    const error = new Error('prUrl must identify a pull request in TARGET_REPO_URL');
    error.status = 400;
    throw error;
  }
  return (await axios.get(`${info.api}/pulls/${prUrl.slice(prefix.length)}`, { headers: githubHeaders(), timeout: 30000 })).data;
}

module.exports = { repositoryInfo, githubHeaders, cloneRepository, validateFiles, writeGeneratedFiles, getPullRequest };
