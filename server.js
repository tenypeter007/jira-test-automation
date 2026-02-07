require('dotenv').config();
const express = require("express");
const { triggerAgent1 } = require('./agents/agent1-test-creator/index.js');
const app = express();

// Built-in JSON parser
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Test route for GET
app.get("/", (req, res) => {
    console.log("GET / hit");
    res.send("Server is running!");
});

// Webhook POST route
app.post("/jira-webhook", async (req, res) => {
    console.log("Webhook received!");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body;

    // Check if it's an issue event
    if (payload.issue) {
        console.log(`Received webhook for issue: ${payload.issue.key}`);

        // Return 200 immediately to Jira so we don't time out
        res.status(200).send("Webhook received, processing...");

        // Trigger Agent 1 asynchronously
        try {
            triggerAgent1(payload.issue).catch(err => {
                console.error("Error in Agent 1 background process:", err);
            });
        } catch (err) {
            console.error("Failed to trigger Agent 1:", err);
        }
    } else {
        // console.log("Webhook received but no issue found in payload");
        res.status(200).send("No issue in payload");
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
