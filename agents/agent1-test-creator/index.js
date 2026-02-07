const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs').promises;
const { updateJiraCard } = require('../../shared/utils/jira-utils.js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Agent 1: Test Case Creator
 * Generates manual test cases from Jira issue description
 */
async function triggerAgent1(issue) {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 AGENT 1: TEST CASE CREATOR');
  console.log('='.repeat(60));
  console.log(`Processing issue: ${issue.key}`);
  console.log('='.repeat(60) + '\n');

  try {
    const issueKey = issue.key;
    const description = issue.fields.description || 'No description provided';
    const summary = issue.fields.summary || '';

    console.log(`📋 Summary: ${summary}`);
    console.log(`📄 Description: ${description.substring(0, 150)}...`);

    // Update Jira: Starting
    await updateJiraCard(issueKey, {
      comment: '🤖 *Agent 1 started*\n\nGenerating test cases from issue description...'
    });

    // Generate test cases using Claude
    console.log('\n🔄 Calling Claude API to generate test cases...');
    const testCases = await generateTestCases(summary, description, issueKey);

    console.log(`\n✅ Generated ${testCases.scenarios.length} test scenarios:`);
    testCases.scenarios.forEach((tc, index) => {
      console.log(`   ${index + 1}. ${tc.id}: ${tc.title} (${tc.priority})`);
    });

    // Save test cases to file
    const testCaseDir = path.join(__dirname, '..', '..', 'shared', 'test-cases');
    const testCasePath = path.join(testCaseDir, `${issueKey}-test-cases.json`);

    await fs.mkdir(testCaseDir, { recursive: true });
    await fs.writeFile(testCasePath, JSON.stringify(testCases, null, 2));

    console.log(`\n💾 Saved test cases to: ${testCasePath}`);

    // Format test cases for Jira comment
    const formattedTestCases = formatTestCasesForJira(testCases);

    // Update Jira with test cases
    await updateJiraCard(issueKey, {
      comment: `🤖 *Agent 1 completed*\n\n✅ Generated ${testCases.scenarios.length} test scenarios:\n\n${formattedTestCases}\n\n_Passing to Agent 2 for Playwright script generation..._`
    });

    console.log('\n✅ Agent 1 completed successfully');
    // console.log('🔄 Triggering Agent 2...\n');

    // Trigger Agent 2
    const { triggerAgent2 } = require('../agent2-script-generator/index.js');
    await triggerAgent2(issue, testCases, testCasePath);
    // console.log('Construction of Agent 2 is pending, so stopping here.');

  } catch (error) {
    console.error('\n❌ Agent 1 error:', error.message);
    console.error(error.stack);

    // Update Jira with error
    try {
      await updateJiraCard(issue.key, {
        comment: `🤖 *Agent 1 failed*\n\n❌ Error: ${error.message}\n\nPlease check the logs and try again.`
      });
    } catch (jiraError) {
      console.error('❌ Failed to update Jira with error:', jiraError.message);
    }

    throw error;
  }
}

/**
 * Generate test cases using Claude API
 */
async function generateTestCases(summary, description, issueKey) {
  const prompt = `You are an expert QA engineer creating comprehensive manual test cases.

**TASK:** Analyze the following Jira ticket and create detailed test cases for each user scenario mentioned.

**JIRA TICKET:**
- **Key:** ${issueKey}
- **Summary:** ${summary}
- **Description:**
${description}

**INSTRUCTIONS:**
1. Carefully read the description and identify ALL user scenarios, use cases, or features mentioned
2. For EACH scenario, create a detailed test case with:
   - Unique Test Case ID (format: TC001, TC002, etc.)
   - Clear, descriptive title
   - Priority level (High/Medium/Low)
   - Complete list of preconditions
   - Detailed step-by-step test instructions with expected results
   - Any required test data
   
3. Make test steps very detailed and specific - include:
   - Exact actions to perform
   - What to click, type, or interact with
   - Expected behavior after each action
   - Any validations to check

4. **IMPORTANT:** Return ONLY valid JSON in this EXACT format (no markdown, no explanations):

{
  "scenarios": [
    {
      "id": "TC001",
      "title": "Verify user can login with valid credentials",
      "scenario": "User Login - Happy Path",
      "priority": "High",
      "preconditions": [
        "User account exists in the system",
        "Browser is open and navigated to login page",
        "User credentials are available"
      ],
      "testSteps": [
        {
          "step": 1,
          "action": "Navigate to the login page at /login",
          "expectedResult": "Login page displays with username and password fields"
        },
        {
          "step": 2,
          "action": "Enter valid username in the username field",
          "expectedResult": "Username is accepted and displayed in the field"
        },
        {
          "step": 3,
          "action": "Enter valid password in the password field",
          "expectedResult": "Password is masked with asterisks"
        },
        {
          "step": 4,
          "action": "Click the 'Login' button",
          "expectedResult": "User is authenticated and redirected to dashboard"
        },
        {
          "step": 5,
          "action": "Verify user name is displayed in header",
          "expectedResult": "Logged-in user's name appears in the top right corner"
        }
      ],
      "testData": {
        "username": "testuser@example.com",
        "password": "ValidPass123!"
      }
    }
  ]
}

**Return ONLY the JSON object. No markdown code blocks, no explanations, just the raw JSON.**`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    console.log('\n📄 Claude Response Preview:', responseText.substring(0, 200) + '...');

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Try to find JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from Claude response');
    }

    const testCases = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!testCases.scenarios || !Array.isArray(testCases.scenarios)) {
      throw new Error('Invalid test case structure: missing scenarios array');
    }

    if (testCases.scenarios.length === 0) {
      throw new Error('No test scenarios generated');
    }

    return testCases;

  } catch (error) {
    console.error('❌ Error calling Claude API:', error.message);
    throw new Error(`Failed to generate test cases: ${error.message}`);
  }
}

/**
 * Format test cases for Jira comment
 */
function formatTestCasesForJira(testCases) {
  let formatted = '';

  testCases.scenarios.forEach((tc, index) => {
    formatted += `*${tc.id}: ${tc.title}*\n`;
    formatted += `Priority: {color:${getPriorityColor(tc.priority)}}${tc.priority}{color}\n`;
    formatted += `Scenario: ${tc.scenario}\n\n`;

    formatted += '*Preconditions:*\n';
    tc.preconditions.forEach(pre => {
      formatted += `• ${pre}\n`;
    });

    formatted += '\n*Test Steps:*\n';
    tc.testSteps.forEach(step => {
      formatted += `${step.step}. ${step.action}\n`;
      formatted += `   _Expected:_ ${step.expectedResult}\n`;
    });

    if (tc.testData && Object.keys(tc.testData).length > 0) {
      formatted += '\n*Test Data:*\n';
      formatted += '{{';
      formatted += JSON.stringify(tc.testData, null, 2);
      formatted += '}}\n';
    }

    if (index < testCases.scenarios.length - 1) {
      formatted += '\n----\n\n';
    }
  });

  return formatted;
}

/**
 * Get color for priority in Jira
 */
function getPriorityColor(priority) {
  const colors = {
    'High': 'red',
    'Medium': 'orange',
    'Low': 'green'
  };
  return colors[priority] || 'gray';
}

module.exports = { triggerAgent1 };