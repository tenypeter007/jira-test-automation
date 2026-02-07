const Anthropic = require('@anthropic-ai/sdk');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const simpleGit = require('simple-git');
const axios = require('axios');
const { updateJiraCard } = require('../../shared/utils/jira-utils.js');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Agent 3: Test Executor with AI-Powered Selector Correction
 * 
 * Workflow:
 * 1. Clone the test repository
 * 2. Run Playwright tests
 * 3. Capture failed selector errors
 * 4. Use Claude to analyze page HTML and suggest correct selectors
 * 5. Auto-correct page objects
 * 6. Re-run tests with corrected selectors
 * 7. Update Jira with final results
 * 8. Push corrections to GitHub (PR)
 */
async function triggerAgent3(issue, prUrl) {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 AGENT 3: TEST EXECUTOR (With AI Selector Correction)');
    console.log('='.repeat(60));

    const issueKey = issue.key;
    const repoUrl = process.env.TARGET_REPO_URL;
    const username = process.env.GITHUB_USERNAME;
    const token = process.env.GITHUB_TOKEN;
    const repoDir = path.join(__dirname, '..', '..', 'temp-repo');

    let testResults = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        correctedSelectors: [],
        startTime: new Date(),
        endTime: null
    };

    try {
        // 1. Setup repository
        console.log('🔄 Preparing test repository...');
        await prepareTestRepo(repoDir, repoUrl, username, token);

        // 2. Run initial tests
        console.log('\n🔄 Running Playwright tests (Headed mode with screenshots)...');
        const initialResults = await runPlaywrightTests(repoDir, true); // true = headed mode
        testResults.totalTests = initialResults.totalTests;
        testResults.passed = initialResults.passed;
        testResults.failed = initialResults.failed;

        console.log(`\n📊 Initial Test Results:`);
        console.log(`   ✅ Passed: ${testResults.passed}`);
        console.log(`   ❌ Failed: ${testResults.failed}`);
        console.log(`   📊 Total: ${testResults.totalTests}`);

        // 3. If tests failed, attempt AI-powered selector correction
        if (testResults.failed > 0) {
            console.log('\n🔄 Analyzing failed selectors with AI...');
            const corrections = await correctFailedSelectors(repoDir, initialResults.failedTests);
            testResults.correctedSelectors = corrections;

            if (corrections.length > 0) {
                console.log(`\n✅ Corrected ${corrections.length} selectors`);

                // 4. Re-run tests with corrected selectors
                console.log('\n🔄 Re-running tests with corrected selectors...');
                const retryResults = await runPlaywrightTests(repoDir, true);
                testResults.passed = retryResults.passed;
                testResults.failed = retryResults.failed;

                console.log(`\n📊 Retry Test Results:`);
                console.log(`   ✅ Passed: ${testResults.passed}`);
                console.log(`   ❌ Failed: ${testResults.failed}`);
            }
        }

        testResults.endTime = new Date();
        const duration = (testResults.endTime - testResults.startTime) / 1000; // seconds

        // 5. Commit corrected selectors if any
        if (testResults.correctedSelectors.length > 0) {
            console.log('\n💾 Committing corrected page objects...');
            await commitCorrections(repoDir, issueKey, testResults.correctedSelectors);

            // Push to new branch
            const timestamp = Date.now();
            const branchName = `fix/${issueKey}-selectors-${timestamp}`;
            await pushCorrections(repoDir, branchName, username, token);

            // Create PR for corrections
            console.log('\n🔄 Creating PR for selector corrections...');
            const correctionPrUrl = await createCorrectionPR(issueKey, branchName, username, token, repoUrl);
            testResults.correctionPrUrl = correctionPrUrl;
        }

        // 6. Update Jira with results
        console.log('\n🔄 Updating Jira issue...');
        await updateJiraWithResults(issueKey, testResults, prUrl);

        console.log('\n✅ Agent 3 completed successfully');
        return testResults;

    } catch (error) {
        console.error('\n❌ Agent 3 error:', error.message);
        console.error(error.stack);

        try {
            await updateJiraCard(issueKey, {
                comment: `🤖 *Agent 3 failed*\n\n❌ Error: ${error.message}`
            });
        } catch (e) { }

        throw error;
    }
}

async function prepareTestRepo(repoDir, repoUrl, username, token) {
    try {
        await fs.rm(repoDir, { recursive: true, force: true });
    } catch (e) { }
    await fs.mkdir(repoDir, { recursive: true });

    const git = simpleGit(repoDir);
    const cleanUrl = repoUrl.replace(/^https?:\/\//, '');
    const authRemote = `https://${username}:${token}@${cleanUrl}`;

    console.log('🔄 Cloning test repository...');
    await git.clone(authRemote, '.');
    console.log('✅ Repository cloned');

    // Install dependencies
    console.log('🔄 Installing dependencies...');
    const { execSync } = require('child_process');
    try {
        execSync('npm install', { cwd: repoDir, stdio: 'pipe' });
    } catch (e) {
        console.warn('⚠️ npm install warnings (non-critical)');
    }
    console.log('✅ Dependencies installed');
}

async function runPlaywrightTests(repoDir, headedMode = false) {
    const { execSync } = require('child_process');
    
    try {
        const command = headedMode 
            ? 'npx playwright test --headed --reporter=html,json'
            : 'npx playwright test --reporter=html,json';

        console.log('Running:', command);
        execSync(command, { 
            cwd: repoDir,
            stdio: 'pipe',
            env: { ...process.env, HEADED: headedMode ? 'true' : 'false' }
        });
    } catch (e) {
        // Playwright exit code is non-zero if tests fail, but it's expected
        console.log('Test run completed (some tests may have failed)');
    }

    // Parse test results
    const resultsPath = path.join(repoDir, 'test-results', 'results.json');
    let testResults = {
        totalTests: 0,
        passed: 0,
        failed: 0,
        failedTests: []
    };

    try {
        const resultsFile = await fs.readFile(resultsPath, 'utf-8');
        const results = JSON.parse(resultsFile);

        results.suites?.forEach(suite => {
            suite.tests?.forEach(test => {
                testResults.totalTests++;
                if (test.status === 'passed') {
                    testResults.passed++;
                } else {
                    testResults.failed++;
                    testResults.failedTests.push({
                        name: test.title,
                        file: test.file,
                        error: test.error?.message || 'Unknown error'
                    });
                }
            });
        });
    } catch (e) {
        console.warn('⚠️ Could not parse test results:', e.message);
    }

    // Get screenshots
    try {
        const screenshotDir = path.join(repoDir, 'test-results');
        const screenshots = await fs.readdir(screenshotDir);
        testResults.screenshots = screenshots.filter(f => f.endsWith('.png'));
    } catch (e) { }

    return testResults;
}

async function correctFailedSelectors(repoDir, failedTests) {
    const corrections = [];

    for (const failedTest of failedTests) {
        try {
            console.log(`\n🔄 Analyzing selector error in: ${failedTest.name}`);

            // Extract element name from error
            const elementMatch = failedTest.error.match(/locator\('([^']+)'\)|selector\('([^']+)'\)|'([^']+)'/);
            const failedSelector = elementMatch?.[1] || elementMatch?.[2] || elementMatch?.[3];

            if (!failedSelector) {
                console.log(`   ⚠️ Could not extract selector from error`);
                continue;
            }

            // Get page HTML for analysis
            const pageFile = path.join(repoDir, failedTest.file);
            const pageContent = await fs.readFile(pageFile, 'utf-8');
            
            // Extract page URL from test
            const urlMatch = pageContent.match(/page\.goto\(['"]([^'"]+)['"]\)/);
            const pageUrl = urlMatch?.[1];

            if (!pageUrl) {
                console.log(`   ⚠️ Could not extract page URL from test`);
                continue;
            }

            console.log(`   📄 Fetching page HTML from: ${pageUrl}`);
            
            // Fetch page HTML
            const pageHtml = await axios.get(pageUrl, { timeout: 10000 }).then(r => r.data).catch(() => null);
            if (!pageHtml) {
                console.log(`   ⚠️ Could not fetch page HTML`);
                continue;
            }

            // Use Claude to analyze and suggest correct selector
            const correctionPrompt = `You are an expert in Playwright and CSS/XPath selectors.

TASK: The following CSS selector FAILED in a Playwright test:
Failed Selector: ${failedSelector}

The error indicates this selector does not exist on the page. Please analyze the HTML provided and suggest a CORRECT selector that will find the intended element.

PAGE HTML (relevant section):
${pageHtml.substring(0, 5000)}

REQUIREMENTS:
1. Return ONLY a JSON object with this exact structure:
{
  "originalSelector": "${failedSelector}",
  "suggestedSelector": "[CSS selector or XPath that should work]",
  "elementType": "[button/input/link/etc]",
  "confidence": "[high/medium/low]",
  "explanation": "[brief explanation of what changed]"
}

2. Prefer CSS selectors over XPath when possible
3. Use data-testid or id attributes if available
4. Return ONLY valid JSON, no markdown, no explanation text

CRITICAL: Return ONLY the JSON object, nothing else.`;

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [{ role: 'user', content: correctionPrompt }]
            });

            let jsonResponse = response.content[0].text;
            jsonResponse = jsonResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            const suggestion = JSON.parse(jsonResponse);

            if (suggestion.confidence === 'high' || suggestion.confidence === 'medium') {
                console.log(`   ✅ Suggested selector: ${suggestion.suggestedSelector}`);
                console.log(`   📝 Reason: ${suggestion.explanation}`);

                // Update page object with new selector
                const updated = await updatePageObjectSelector(repoDir, failedTest.file, suggestion);
                if (updated) {
                    corrections.push({
                        test: failedTest.name,
                        file: failedTest.file,
                        originalSelector: suggestion.originalSelector,
                        newSelector: suggestion.suggestedSelector
                    });
                    console.log(`   ✅ Page object updated`);
                }
            } else {
                console.log(`   ⚠️ Low confidence suggestion, skipping`);
            }

        } catch (error) {
            console.log(`   ❌ Error analyzing selector: ${error.message}`);
        }
    }

    return corrections;
}

async function updatePageObjectSelector(repoDir, testFile, suggestion) {
    try {
        // Find corresponding page object file
        const testContent = await fs.readFile(path.join(repoDir, testFile), 'utf-8');
        
        // Extract page import
        const pageImportMatch = testContent.match(/import\s+{\s*(\w+)\s*}\s+from\s+['"]([^'"]+)['"]/);
        if (!pageImportMatch) return false;

        const pageClassName = pageImportMatch[1];
        const pageFilePath = path.join(path.dirname(testFile), pageImportMatch[2] + '.ts');
        const absolutePagePath = path.join(repoDir, pageFilePath);

        // Read and update page object
        let pageContent = await fs.readFile(absolutePagePath, 'utf-8');

        // Replace old selector with new one (handle various selector patterns)
        const selectorPatterns = [
            new RegExp(`(['"\`\\(])${escapeRegex(suggestion.originalSelector)}(['"\`\\)])`, 'g'),
            new RegExp(`: ['"\`]${escapeRegex(suggestion.originalSelector)}['"\`]`, 'g')
        ];

        let updated = false;
        for (const pattern of selectorPatterns) {
            if (pattern.test(pageContent)) {
                pageContent = pageContent.replace(pattern, `$1${suggestion.suggestedSelector}$2`);
                updated = true;
                break;
            }
        }

        if (updated) {
            await fs.writeFile(absolutePagePath, pageContent);
            return true;
        }

        return false;
    } catch (error) {
        console.log(`   ⚠️ Could not update page object: ${error.message}`);
        return false;
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function commitCorrections(repoDir, issueKey, corrections) {
    const git = simpleGit(repoDir);

    const commitMessage = `fix(${issueKey}): Auto-correct failed selectors with AI analysis

Corrected selectors:
${corrections.map(c => `- ${c.originalSelector} → ${c.newSelector}`).join('\n')}

Generated by Agent 3 (AI Selector Correction)`;

    try {
        await git.add('tests/pages/');
        await git.commit(commitMessage);
        console.log('✅ Changes committed');
    } catch (error) {
        if (error.message.includes('nothing to commit')) {
            console.log('ℹ️ No changes to commit');
        } else {
            throw error;
        }
    }
}

async function pushCorrections(repoDir, branchName, username, token, repoUrl) {
    const git = simpleGit(repoDir);

    // Configure git
    await git.addConfig('user.name', 'Antigravity Agent 3');
    await git.addConfig('user.email', 'agent3@antigravity.ai');

    try {
        await git.checkoutLocalBranch(branchName);
        await git.push('origin', branchName);
        console.log(`✅ Pushed to branch: ${branchName}`);
    } catch (error) {
        console.log(`ℹ️ Could not push corrections: ${error.message}`);
    }
}

async function createCorrectionPR(issueKey, branchName, username, token, repoUrl) {
    const parts = repoUrl.replace('.git', '').split('/');
    const repoName = parts[parts.length - 1];
    const owner = parts[parts.length - 2];

    const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls`;

    try {
        const payload = {
            title: `fix: Auto-corrected selectors for ${issueKey}`,
            head: branchName,
            base: 'main',
            body: `This PR contains automatically corrected selectors for failed tests in issue ${issueKey}.\n\nGenerated by AI Agent 3 (Selector Correction Engine).`
        };

        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        return response.data.html_url;
    } catch (error) {
        console.error('Could not create correction PR:', error.message);
        return null;
    }
}

async function updateJiraWithResults(issueKey, testResults, prUrl) {
    const duration = Math.round((testResults.endTime - testResults.startTime) / 1000);
    const passPercentage = testResults.totalTests > 0 
        ? Math.round((testResults.passed / testResults.totalTests) * 100)
        : 0;

    let comment = `🤖 *Agent 3: Test Execution Complete*\n\n`;
    comment += `📊 *Test Results:*\n`;
    comment += `- ✅ Passed: ${testResults.passed}/${testResults.totalTests}\n`;
    comment += `- ❌ Failed: ${testResults.failed}/${testResults.totalTests}\n`;
    comment += `- 📈 Success Rate: ${passPercentage}%\n`;
    comment += `- ⏱️ Duration: ${duration}s\n\n`;

    if (testResults.correctedSelectors.length > 0) {
        comment += `🔧 *Selectors Corrected:* ${testResults.correctedSelectors.length}\n`;
        testResults.correctedSelectors.forEach(correction => {
            comment += `- \`${correction.originalSelector}\` → \`${correction.newSelector}\`\n`;
        });
        comment += '\n';
    }

    if (testResults.correctionPrUrl) {
        comment += `📝 *Correction PR:* [${testResults.correctionPrUrl}|${testResults.correctionPrUrl}]\n`;
    }

    if (prUrl) {
        comment += `\n🔗 *Test PR:* [${prUrl}|${prUrl}]\n`;
    }

    comment += `\n_Generated by Antigravity Agent 3 with AI Selector Correction Engine_`;

    await updateJiraCard(issueKey, {
        comment: comment,
        status: testResults.failed === 0 ? 'DONE' : 'IN PROGRESS'
    });
}

module.exports = { triggerAgent3 };
