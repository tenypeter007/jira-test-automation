require('dotenv').config();
const express = require("express");
const { triggerAgent1 } = require('./agents/agent1-test-creator/index.js');
const { triggerAgent2, generatePlaywrightScript } = require('./agents/agent2-script-generator/index.js');
const { triggerAgent3 } = require('./agents/agent3-test-executor/index.js');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Built-in JSON parser
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check
app.get("/", (req, res) => {
    console.log("GET / hit");
    res.json({
        status: "running",
        service: "Jira Test Automation Framework",
        agents: ["Agent 1 (Test Creator)", "Agent 2 (Script Generator)", "Agent 3 (Test Executor)"],
        version: "1.0.0"
    });
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/**
 * Webhook from Jira when issue is created/updated
 * Triggers full automation workflow
 */
app.post("/jira-webhook", async (req, res) => {
    console.log("Webhook received!");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body;

    // Check if it's an issue event
    if (payload.issue) {
        const issueKey = payload.issue.key;
        console.log(`Received webhook for issue: ${issueKey}`);

        // Return 200 immediately to Jira so we don't time out
        res.status(200).send(`Processing issue ${issueKey}...`);

        // Trigger full workflow asynchronously
        triggerFullWorkflow(payload.issue).catch(err => {
            console.error("Error in full workflow:", err);
        });
    } else {
        res.status(200).send("No issue in payload");
    }
});

/**
 * Full automation workflow:
 * 1. Agent 1: Generate test cases
 * 2. Agent 2: Generate Playwright scripts
 * 3. Agent 3: Execute tests with AI-powered selector correction
 */
async function triggerFullWorkflow(issue) {
    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🚀 STARTING FULL AUTOMATION WORKFLOW FOR ${issue.key}`);
        console.log(`${'='.repeat(60)}`);

        // Step 1: Agent 1 - Create test cases
        console.log(`\n📝 Step 1: Running Agent 1 (Test Creator)...`);
        await triggerAgent1(issue);
        console.log(`✅ Agent 1 completed`);

        // Get test cases for Agent 2
        const testCasePath = path.join(__dirname, 'shared', 'test-cases', `${issue.key}-test-cases.json`);
        let testCases = [];
        try {
            const content = await fs.readFile(testCasePath, 'utf-8');
            const data = JSON.parse(content);
            testCases = data.testCases || [];
            console.log(`📊 Loaded ${testCases.length} test cases`);
        } catch (e) {
            console.warn(`⚠️ Could not load test cases from ${testCasePath}`);
        }

        // Step 2: Agent 2 - Generate Playwright scripts
        console.log(`\n🎭 Step 2: Running Agent 2 (Script Generator)...`);
        let prUrl = null;
        try {
            await triggerAgent2(issue, testCases, testCasePath);
            // Try to extract PR URL from recent git operations
            prUrl = `https://github.com/${process.env.GITHUB_USERNAME}/${process.env.TARGET_REPO_URL.split('/').pop().replace('.git', '')}/pulls`;
            console.log(`✅ Agent 2 completed - PR: ${prUrl}`);
        } catch (e) {
            console.error(`⚠️ Agent 2 error: ${e.message}`);
        }

        // Step 3: Agent 3 - Execute tests with selector correction
        console.log(`\n🧪 Step 3: Running Agent 3 (Test Executor)...`);
        try {
            await triggerAgent3(issue, prUrl);
            console.log(`✅ Agent 3 completed`);
        } catch (e) {
            console.error(`⚠️ Agent 3 error: ${e.message}`);
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ WORKFLOW COMPLETED FOR ${issue.key}`);
        console.log(`${'='.repeat(60)}\n`);

    } catch (error) {
        console.error("❌ Fatal error in workflow:", error);
    }
}

/**
 * Manual triggers for individual agents
 */

// Trigger Agent 1 only
app.post("/agents/1", async (req, res) => {
    const issueKey = req.body.issueKey || "SCRUM-6";
    console.log(`Manual trigger for Agent 1 with issue: ${issueKey}`);
    res.json({ status: "Agent 1 triggered", issueKey });
    
    // In real scenario, would fetch from Jira API
    triggerAgent1({ key: issueKey, summary: "Manual test" }).catch(err => {
        console.error("Agent 1 error:", err);
    });
});

// Trigger Agent 2 only
app.post("/agents/2", async (req, res) => {
    const issueKey = req.body.issueKey || "SCRUM-6";
    console.log(`Manual trigger for Agent 2 with issue: ${issueKey}`);
    res.json({ status: "Agent 2 triggered", issueKey });
    
    const testCasePath = path.join(__dirname, 'shared', 'test-cases', `${issueKey}-test-cases.json`);
    let testCases = [];
    try {
        const content = await fs.readFile(testCasePath, 'utf-8');
        const data = JSON.parse(content);
        testCases = data.testCases || [];
    } catch (e) {
        console.warn(`Could not load test cases: ${e.message}`);
    }

    triggerAgent2({ key: issueKey }, testCases, testCasePath).catch(err => {
        console.error("Agent 2 error:", err);
    });
});

// Trigger Agent 3 only
app.post("/agents/3", async (req, res) => {
    const issueKey = req.body.issueKey || "SCRUM-6";
    const prUrl = req.body.prUrl || null;
    console.log(`Manual trigger for Agent 3 with issue: ${issueKey}`);
    res.json({ status: "Agent 3 triggered", issueKey, prUrl });
    
    triggerAgent3({ key: issueKey }, prUrl).catch(err => {
        console.error("Agent 3 error:", err);
    });
});

// Trigger all agents
app.post("/agents/all", async (req, res) => {
    const issueKey = req.body.issueKey || "SCRUM-6";
    console.log(`Manual trigger for all agents with issue: ${issueKey}`);
    res.json({ status: "All agents triggered", issueKey });
    
    triggerFullWorkflow({ key: issueKey, summary: "Manual test" }).catch(err => {
        console.error("Workflow error:", err);
    });
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
