# Jira Test Automation Framework

An AI-powered automation framework that integrates Jira with Playwright end-to-end testing. This system uses autonomous AI agents to generate test cases, create Playwright test scripts, and execute tests based on Jira issues.

## 🎯 Overview

This framework automates the entire test automation workflow:
- **Agent 1:** Reads Jira issues and generates comprehensive test cases
- **Agent 2:** Converts test cases into Playwright test scripts and page objects
- **Agent 3:** Executes the generated tests and updates Jira with results

## 📋 Features

- 🤖 **AI-Powered Test Generation** - Uses Claude API to intelligently generate test cases from Jira issues
- 🎭 **Playwright Integration** - Generates production-ready Playwright scripts with Page Object Model
- 📊 **Jira Integration** - Seamlessly reads from and updates Jira with test status and results
- 🔄 **GitHub Integration** - Automatically creates pull requests with generated test code
- 📝 **Page Object Model** - Follows best practices with organized page objects and test specs
- 🚀 **Multi-Agent Architecture** - Distributed task processing with specialized agents

## 🏗️ Project Structure

```
jira-test-automation/
├── agents/
│   ├── agent1-test-creator/          # Generates test cases from Jira issues
│   │   └── index.js
│   ├── agent2-script-generator/      # Creates Playwright scripts and pages
│   │   └── index.js
│   └── agent3-test-executor/         # Executes tests and reports results
│       └── index.js
├── shared/
│   ├── config/                       # Shared configuration files
│   ├── logs/                         # Application logs
│   ├── test-cases/                   # Generated test cases
│   └── utils/
│       └── jira-utils.js             # Jira API utilities
├── playwright-tests/                 # Local test execution files
├── scripts/                          # Utility scripts
├── temp-repo/                        # Temporary repository for git operations
├── server.js                         # Main Express server
├── package.json                      # Dependencies and scripts
└── .env                             # Environment configuration
```

## 🔧 Prerequisites

- **Node.js** (v14 or higher)
- **npm** or **yarn**
- **Git**
- **Jira Account** with API access
- **Anthropic API Key** (Claude)
- **GitHub Account** with personal access token
- **Playwright** (installed via npm)

## 📦 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/tenypeter007/jira-test-automation.git
   cd jira-test-automation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create or update `.env` file with your credentials:

   ```env
   # Jira Configuration
   JIRA_HOST=your-instance.atlassian.net
   JIRA_EMAIL=your-email@example.com
   JIRA_API_TOKEN=your-jira-api-token

   # Anthropic API
   ANTHROPIC_API_KEY=your-anthropic-api-key

   # GitHub Configuration
   GITHUB_TOKEN=your-github-personal-access-token
   GITHUB_USERNAME=your-github-username
   TARGET_REPO_URL=https://github.com/your-username/your-playwright-repo.git

   # Server
   PORT=3000
   ```

## 🚀 Getting Started

### Start the Server

```bash
npm start
```

The server will run on `http://localhost:3000`

### Run All Agents for a Jira Issue

```bash
node server.js --issue SCRUM-6
```

### Agent Details

#### **Agent 1: Test Case Creator** 
- Reads Jira issue key and description
- Uses Claude to generate comprehensive test cases
- Stores test cases in `/shared/test-cases/`
- Saves test cases as JSON with:
  - Preconditions
  - Steps
  - Expected results
  - Test data

#### **Agent 2: Script Generator**
- Converts test cases into Playwright TypeScript code
- Creates only:
  - 📄 **Page Objects** in `tests/pages/` (extends BasePage)
  - 🧪 **Test Specs** in `tests/e2e/` or `tests/ui/`
  - 📊 **Test Data** in `tests/testdata.ts` (when needed)
- Pushes code to GitHub as a pull request
- Updates Jira with PR link

#### **Agent 3: Test Executor**
- Executes generated Playwright tests
- Captures test results and screenshots
- Updates Jira issue with:
  - Test execution status
  - Pass/fail counts
  - Test duration
  - Links to test reports

## 📝 Configuration Details

### Jira Setup

1. Get your Jira API token:
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Create new API token
   - Copy and paste into `.env`

2. Ensure your Jira instance has basic project setup

### GitHub Setup

1. Create personal access token:
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Generate new token with `repo` scope
   - Copy and paste into `.env`

2. Create target Playwright repository:
   - The `TARGET_REPO_URL` should point to an existing Playwright test repository
   - Recommended: https://github.com/tenypeter007/saucedemo-playwright

### Anthropic API

1. Get API key from https://console.anthropic.com
2. Add to `.env` as `ANTHROPIC_API_KEY`

## 🎯 Usage Examples

### Generate Test Cases Only
```bash
node agents/agent1-test-creator/index.js
```

### Generate Scripts from Test Cases
```bash
node agents/agent2-script-generator/index.js
```

### Execute Tests
```bash
node agents/agent3-test-executor/index.js
```

## 📊 Test Case Format

Test cases are stored as JSON:

```json
{
  "testCases": [
    {
      "title": "Test Case Title",
      "preconditions": ["User is logged in"],
      "steps": [
        "Click on button",
        "Fill form"
      ],
      "expectedResults": ["Success message displayed"],
      "testData": {
        "username": "test@example.com"
      }
    }
  ]
}
```

## 🎭 Generated Playwright Structure

Agent 2 follows the strict repository structure:

```
tests/
├── pages/
│   ├── BasePage.ts          (Base class)
│   ├── LoginPage.ts
│   └── CheckoutPage.ts
├── e2e/
│   ├── login.spec.ts
│   └── checkout.spec.ts
├── ui/
│   └── inventory.spec.ts
├── testdata.ts
└── fixtures/
```

## 🔐 Security Notes

⚠️ **Important:** Never commit the `.env` file to version control. It contains sensitive credentials.

The `.gitignore` file already excludes:
- `.env` and `.env.local`
- `node_modules/`
- `dist/` and `build/`
- Log files
- Temporary directories

## 🐛 Troubleshooting

### "JIRA_API_TOKEN is not set"
- Verify `.env` file exists in project root
- Check JIRA_API_TOKEN value is correct
- Restart the server

### "GitHub API Error"
- Verify GITHUB_TOKEN has `repo` scope
- Check TARGET_REPO_URL points to valid repository
- Ensure repository is accessible with the token

### "Claude API Error"
- Verify ANTHROPIC_API_KEY is valid
- Check API key has sufficient quota
- Review API rate limits

## 📚 API Reference

### Server Endpoints

```bash
GET  /health              # Health check
POST /generate-tests      # Trigger all agents for an issue
POST /agent/1             # Trigger Agent 1 only
POST /agent/2             # Trigger Agent 2 only
POST /agent/3             # Trigger Agent 3 only
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is open source and available under the MIT License.

## 👤 Author

**Teny Peter**
- GitHub: [@tenypeter007](https://github.com/tenypeter007)
- Email: teny.peter007@gmail.com

## 🔗 Related Projects

- **Target Repository:** [saucedemo-playwright](https://github.com/tenypeter007/saucedemo-playwright)
- **Jira Instance:** [tenypeter007.atlassian.net](https://tenypeter007.atlassian.net)

## 📞 Support

For issues, questions, or suggestions:
1. Check the troubleshooting section
2. Review existing GitHub issues
3. Create a new issue with detailed description

---

**Last Updated:** February 7, 2026
