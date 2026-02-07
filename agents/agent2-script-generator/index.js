const Anthropic = require('@anthropic-ai/sdk');
const simpleGit = require('simple-git');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { updateJiraCard } = require('../../shared/utils/jira-utils.js');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Agent 2: Playwright Script Generator
 * Generates Playwright script, pushes to GitHub, and creates a PR.
 */
async function triggerAgent2(issue, testCases, testCasePath) {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 AGENT 2: SCRIPT GENERATOR (GitHub Integration)');
    console.log('='.repeat(60));

    const issueKey = issue.key;
    const repoUrl = process.env.TARGET_REPO_URL;
    const username = process.env.GITHUB_USERNAME;
    const token = process.env.GITHUB_TOKEN;

    // Work in a temporary directory for the repo
    const repoDir = path.join(__dirname, '..', '..', 'temp-repo');

    try {
        // 1. Generate Playwright Script using Claude
        console.log('🔄 Generating Playwright script with Claude...');
        const scriptContent = await generatePlaywrightScript(testCases);
        console.log('✅ Generated script content.');

        // 2. Clone/Prepare Repo
        console.log(`\n🔄 Preparing repository: ${repoUrl}`);

        // Clean old repo dir if exists
        try {
            await fs.rm(repoDir, { recursive: true, force: true });
        } catch (e) { }
        await fs.mkdir(repoDir, { recursive: true });

        const git = simpleGit(repoDir);

        // Auth URL
        const cleanUrl = repoUrl.replace(/^https?:\/\//, '');
        const authRemote = `https://${username}:${token}@${cleanUrl}`;

        console.log('🔄 Cloning repository...');
        await git.clone(authRemote, '.');

        // Configure Git User
        await git.addConfig('user.name', 'Antigravity Agent');
        await git.addConfig('user.email', 'antigravity-agent@example.com');

        // 3. Create Feature Branch with timestamp to avoid conflicts
        const timestamp = Date.now();
        const branchName = `feature/${issueKey}-tests-${timestamp}`;
        console.log(`🔄 Creating branch: ${branchName}`);
        await git.checkoutLocalBranch(branchName);

        // 4. Save Files to Repo
        console.log('💾 Writing generated files...');
        const generatedFiles = scriptContent; // Now an array of {path, content}

        for (const file of generatedFiles) {
            const fullPath = path.join(repoDir, file.path);
            const dir = path.dirname(fullPath);

            // Ensure directory exists
            await fs.mkdir(dir, { recursive: true });

            // Write file
            await fs.writeFile(fullPath, file.content);
            console.log(`   ✓ ${file.path}`);
        }

        // 5. Commit and Push
        console.log('🔄 Committing and Pushing...');
        await git.add('.');
        await git.commit(`Add automated tests for ${issueKey}`);
        await git.push('origin', branchName);
        console.log('✅ Pushed changes to GitHub.');

        // 6. Create Pull Request
        console.log('🔄 Creating Pull Request...');
        const prUrl = await createPullRequest(issueKey, branchName, username, token, repoUrl);
        console.log(`✅ PR Created: ${prUrl}`);

        // 7. Update Jira
        const fileList = generatedFiles.map(f => f.path).join('\n- ');
        await updateJiraCard(issueKey, {
            comment: `🤖 *Agent 2 completed*\n\n✅ Created PR: [${prUrl}|${prUrl}]\n\n*Generated Files:*\n- ${fileList}`
        });

        console.log('\n✅ Agent 2 completed successfully');

    } catch (error) {
        console.error('\n❌ Agent 2 error:', error.message);
        console.error(error.stack);

        try {
            await updateJiraCard(issueKey, {
                comment: `🤖 *Agent 2 failed*\n\n❌ Error: ${error.message}`
            });
        } catch (e) { }

        throw error;
    }
}

async function generatePlaywrightScript(testCases) {
    const prompt = `You are an expert Playwright automation engineer.

**CRITICAL RESTRICTIONS - DO NOT VIOLATE THESE:**
⛔ DO NOT create any framework files
⛔ DO NOT create common-actions.ts or utilities
⛔ DO NOT create any files outside of tests/pages/ and tests/ subdirectories
⛔ ONLY generate: Page Objects and Test Specs
⛔ ONLY optionally update: tests/testdata.ts

**TASK:** Convert the following test cases into Playwright tests following the EXACT repository structure.

**TEST CASES:**
${JSON.stringify(testCases, null, 2)}

**REPOSITORY STRUCTURE TO FOLLOW:**
The target repository uses this EXACT structure:
- tests/pages/ - Page Object Models only
- tests/e2e/ - End-to-end test specs
- tests/ui/ - UI test specs  
- tests/visual/ - Visual regression test specs
- tests/testdata.ts - Shared test data (ONLY update if needed)

Example files that exist (DO NOT RECREATE):
- tests/pages/BasePage.ts (base class for all pages)
- tests/pages/LoginPage.ts
- tests/pages/InventoryPage.ts
- tests/e2e/login.spec.ts
- tests/ui/login.spec.ts
- tests/testdata.ts

**REQUIREMENTS:**
1. Create ONLY these types of files (nothing else):
   a) Page Objects: tests/pages/[PageName].ts
   b) Test Specs: tests/e2e/[name].spec.ts OR tests/ui/[name].spec.ts (choose based on test type)
   c) OPTIONALLY update: tests/testdata.ts (only if new test data is needed)

2. **Page Object Pattern (tests/pages/):**
   - Extend BasePage class: \`export class MyPage extends BasePage { ... }\`
   - Class name in PascalCase (e.g., CheckoutPage)
   - File name in PascalCase.ts (e.g., CheckoutPage.ts)
   - Has selectors and methods for page interactions
   - Imports: \`import { Page } from '@playwright/test';\` and \`import { BasePage } from './BasePage';\`

3. **Test Spec Pattern (tests/e2e/ or tests/ui/):**
   - Imports: \`import { test } from '@playwright/test';\`
   - Import page objects: \`import { LoginPage } from '../pages/LoginPage';\`
   - Use test.describe() for grouping
   - Use test() or test.only() for individual tests
   - Structure: \`test('should...', async ({ page }) => { ... })\`

4. **Output Format:** Return ONLY a JSON object:
   {
     "files": [
       { "path": "tests/pages/CheckoutPage.ts", "content": "..." },
       { "path": "tests/e2e/checkout.spec.ts", "content": "..." },
       { "path": "tests/testdata.ts", "content": "..." }
     ]
   }
   - Only include files you're creating/updating
   - Do NOT include framework files or other utilities

5. **FILE PATH RULES:**
   - Page Objects MUST be in: tests/pages/[PageName].ts
   - Test Specs MUST be in: tests/e2e/[name].spec.ts OR tests/ui/[name].spec.ts
   - Test Data MUST be in: tests/testdata.ts (only if updating)

6. **CRITICAL:** 
   - Return ONLY valid JSON. No markdown, no explanations, no code fences.
   - If unsure about a directory, place specs in tests/e2e/ by default
   - Do not create setup files, hooks, or other auxiliary files
`;

    const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
    });

    let response = message.content[0].text;

    // Clean markdown if present
    response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Parse JSON
    const result = JSON.parse(response);

    if (!result.files || !Array.isArray(result.files)) {
        throw new Error('Invalid response format: expected { files: [...] }');
    }

    // Validate that only allowed file types are being created
    const allowedDirs = ['tests/pages/', 'tests/e2e/', 'tests/ui/', 'tests/visual/'];
    const allowedFiles = ['tests/testdata.ts'];
    
    for (const file of result.files) {
        const isAllowedDir = allowedDirs.some(dir => file.path.startsWith(dir));
        const isAllowedFile = allowedFiles.some(allowedFile => file.path === allowedFile);
        
        if (!isAllowedDir && !isAllowedFile) {
            throw new Error(`INVALID FILE PATH: ${file.path}. Only allowed: tests/pages/, tests/e2e/, tests/ui/, tests/visual/, and tests/testdata.ts`);
        }
    }

    return result.files;
}

async function createPullRequest(issueKey, branchName, username, token, repoUrl) {
    // Extract owner and repo from URL
    // e.g., https://github.com/tenypeter007/playwright-page-object.git
    const parts = repoUrl.replace('.git', '').split('/');
    const repoName = parts[parts.length - 1]; // playwright-page-object
    const owner = parts[parts.length - 2];   // tenypeter007

    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls`;

    try {
        const payload = {
            title: `feat: Automated tests for ${issueKey}`,
            head: branchName,
            base: 'main', // Default branch is main
            body: `This PR adds automated Playwright tests for Jira issue ${issueKey}.\n\nGenerated by AI Agent.`
        };

        console.log("🚀 Creating PR with payload:", JSON.stringify(payload, null, 2));

        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        return response.data.html_url;
    } catch (error) {
        if (error.response && error.response.data) {
            console.error("GitHub API Detailed Error:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("GitHub API Error:", error.message);
        }
        throw new Error(`Failed to create PR: ${error.message}`);
    }
}

module.exports = { triggerAgent2, generatePlaywrightScript };
