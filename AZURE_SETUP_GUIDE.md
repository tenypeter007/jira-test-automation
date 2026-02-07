# Azure CI/CD Setup Guide

This guide walks you through setting up Azure Pipelines to run Agent 3 tests automatically on every pull request.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Install Azure CLI](#step-1-install-azure-cli)
3. [Step 2: Run Deployment Script](#step-2-run-deployment-script)
4. [Step 3: Set Up Azure Pipelines](#step-3-set-up-azure-pipelines)
5. [Step 4: Create Pipeline Variables](#step-4-create-pipeline-variables)
6. [Step 5: Enable CI/CD on PR](#step-5-enable-cicd-on-pr)

---

## Prerequisites

### What You Need:
- ✅ Azure Account with $250 free trial (or active subscription)
- ✅ GitHub Account with the source repository
- ✅ Target Playwright repository (https://github.com/tenypeter007/saucedemo-playwright)
- ✅ All credentials ready (.env file values)

### Credentials to Gather:
```
JIRA_HOST=tenypeter007.atlassian.net
JIRA_EMAIL=teny.peter007@gmail.com
JIRA_API_TOKEN=ATATT3xF...
ANTHROPIC_API_KEY=sk-ant-api03-...
GITHUB_TOKEN=github_pat_11AL...
GITHUB_USERNAME=tenypeter007
TARGET_REPO_URL=https://github.com/tenypeter007/saucedemo-playwright.git
```

---

## Step 1: Install Azure CLI

### **Windows (You are here!)**

#### **Option A: Direct Download (Easiest)**
1. Download the installer: https://aka.ms/installazurecliwindows
2. Run the `.msi` file
3. Follow the installer wizard
4. **Restart PowerShell**

#### **Option B: Using Chocolatey**
```powershell
choco install azure-cli
```

#### **Option C: Using winget**
```powershell
winget install Microsoft.AzureCLI
```

### **Verify Installation:**
```powershell
az --version
```

Expected output:
```
azure-cli                         2.60.0
cli-core                          2.60.0
...
```

---

## Step 2: Run Deployment Script

This script automates all Azure resource creation.

### **Using PowerShell (Windows):**

```powershell
# Navigate to the project directory
cd c:\Users\tenyp\OneDrive\Documents\jira-test-automation

# Run the deployment script
.\scripts\azure-deploy.ps1
```

### **What the Script Does:**
1. ✅ Logs you into Azure
2. ✅ Creates Resource Group
3. ✅ Creates Container Registry
4. ✅ Builds Docker image
5. ✅ Creates Key Vault (for secrets)
6. ✅ Stores all secrets securely
7. ✅ Creates App Service Plan
8. ✅ Creates Web App
9. ✅ Configures everything

### **Interactive Prompts:**
The script will ask for:
```
Resource Group Name: [jira-automation-rg]
Location: [eastus]
Container Registry: [jiraautomationacr]
Project Name: [jira-automation]

Then your secrets:
- JIRA_HOST
- JIRA_EMAIL
- JIRA_API_TOKEN (hidden input)
- ANTHROPIC_API_KEY (hidden input)
- GITHUB_TOKEN (hidden input)
- GITHUB_USERNAME
- TARGET_REPO_URL
```

### **Expected Output:**
```
✅ Setup Complete!

Resource Group: jira-automation-rg
Registry: jiraautomationacr.azurecr.io
Key Vault: jiraautomationacr-kv
Web App: jiraautomationacr-app
App Service Plan: jiraautomationacr-plan
```

---

## Step 3: Set Up Azure Pipelines

### **3.1 Go to Azure DevOps**

1. Visit: https://dev.azure.com
2. Sign in with your Azure/Microsoft account
3. Create or select an organization

### **3.2 Create a New Project**

1. Click "New project"
2. Fill in:
   - **Project name:** `jira-automation`
   - **Visibility:** Public (or Private)
3. Click "Create"

### **3.3 Connect GitHub Repository**

1. In Azure DevOps, go to **Project Settings**
2. Go to **Service Connections**
3. Click **New service connection**
4. Select **GitHub**
5. Authenticate with GitHub
6. Select your repository: `tenypeter007/jira-test-automation`
7. Save

### **3.4 Create Pipeline from YAML**

1. Go to **Pipelines** → **Pipelines**
2. Click **New pipeline**
3. Select **GitHub**
4. Select your repository
5. Select **Existing Azure Pipelines YAML file**
6. Branch: `main`, Path: `/azure-pipelines.yml`
7. Click **Continue**
8. Click **Save** (not Run yet)

---

## Step 4: Create Pipeline Variables

Pipeline variables are used in the YAML file to configure resources.

### **In Azure DevOps:**

1. Go to your pipeline
2. Click **Edit**
3. Click **Variables** (top right)
4. Add the following variables:

| Variable Name | Value | Secret? |
|--------------|-------|---------|
| AZURE_SUBSCRIPTION | `<Your subscription ID>` | ✅ Yes |
| AZURE_REGISTRY_CONNECTION | `<Service connection name>` | No |
| AZURE_REGISTRY_NAME | `jiraautomationacr` | No |
| AZURE_RESOURCE_GROUP | `jira-automation-rg` | No |
| JIRA_HOST | `tenypeter007.atlassian.net` | No |
| JIRA_EMAIL | Your Jira email | ✅ Yes |
| JIRA_API_TOKEN | Your API token | ✅ Yes |
| ANTHROPIC_API_KEY | Your Claude API key | ✅ Yes |
| GITHUB_TOKEN | Your GitHub token | ✅ Yes |
| GITHUB_USERNAME | `tenypeter007` | No |
| TARGET_REPO_URL | Your target repo URL | No |

### **Mark as Secret:**
For sensitive values (tokens, API keys):
1. Click the lock icon next to the variable
2. Mark as secret

### **Get Subscription ID:**
```powershell
az account show --query id -o tsv
```

### **Get Service Connection Name:**
```powershell
az devops service-endpoint list --project jira-automation --query [0].name -o tsv
```

---

## Step 5: Enable CI/CD on PR

### **5.1 Pipeline Trigger Settings**

Your `azure-pipelines.yml` already has:
```yaml
trigger:
  - main

pr:
  - main
```

This means the pipeline runs on:
- Every push to `main` branch
- Every pull request to `main` branch

### **5.2 Test It**

1. Create a test branch:
   ```bash
   git checkout -b test/pipeline
   ```

2. Make a small change:
   ```bash
   echo "# Testing Pipeline" >> README.md
   ```

3. Commit and push:
   ```bash
   git add README.md
   git commit -m "test: trigger pipeline"
   git push origin test/pipeline
   ```

4. Create a Pull Request on GitHub
5. Go to Azure DevOps → Pipelines
6. You should see the pipeline running!

---

## 🎯 Pipeline Workflow

When a PR is created, the pipeline:

```
1. Build Stage
   ├─ Build Docker image
   └─ Push to registr

2. Test Stage
   ├─ Run Playwright tests (Headed mode)
   ├─ Capture screenshots
   ├─ Use Claude to correct failed selectors
   ├─ Re-run failed tests
   └─ Publish test results

3. Deploy Stage
   ├─ Deploy to Azure Container Instances
   └─ Run as containerized service

4. Cleanup Stage
   └─ Remove old container instances
```

---

## 📊 Monitoring Test Runs

### **View Pipeline Runs:**
1. Go to Azure DevOps
2. Click **Pipelines** → **Pipelines**
3. Select your pipeline
4. Click on any run to see details

### **View Test Results:**
1. In the pipeline run, click **Test** tab
2. See passed/failed tests
3. Download test reports
4. View screenshots

### **View Logs:**
```powershell
# For Web App
az webapp log tail --name jiraautomationacr-app --resource-group jira-automation-rg

# For Container Instances
az container logs --resource-group jira-automation-rg --name jira-automation-test-runner
```

---

## 🔄 What Happens When Tests Fail

1. **Selector Error Detected** ❌
2. **Claude Analyzes Page HTML** 🤖
3. **Correct Selector Suggested** ✅
4. **Page Object Auto-Updated** 📝
5. **Test Re-runs with New Selector** 🔄
6. **Result: ✅ PASSED or ❌ Still Failed**
7. **If Corrected:** Creates PR with fixes
8. **Updates Jira** with results

---

## 💰 Cost Estimation

With your $250 credit:

| Service | Monthly Cost | Months Cover |
|---------|-------------|---|
| Container Registry (Basic) | ~$5 | 50 |
| App Service Plan (B1) | ~$15 | 17 |
| Container Instances | ~$1 per test | Varies |
| Key Vault | ~$0.60 | 400+ |
| **Total** | ~$20 | **~12 months** |

✅ **You're well within budget!**

---

## 🚀 Troubleshooting

### **Pipeline Won't Start:**
1. Check Variable values in Azure DevOps
2. Verify service connection is authenticated
3. Check GitHub repo is connected

### **Docker Build Fails:**
```powershell
# Test build locally
docker build -t jira-test-automation:test .
```

### **Tests Can't Access GitHub:**
1. Verify GITHUB_TOKEN is valid
2. Check TARGET_REPO_URL is correct
3. Ensure token has `repo` scope

### **Tests Can't Access Jira:**
1. Verify JIRA_API_TOKEN is correct
2. Check JIRA_HOST format (no https://)
3. Verify JIRA_EMAIL is correct

### **Playwright Timeouts:**
1. Increase timeout in playwright.config.ts
2. Check target app is accessible
3. Verify network connectivity from Azure

---

## 📚 Additional Resources

- [Azure Pipelines Docs](https://docs.microsoft.com/en-us/azure/devops/pipelines)
- [Playwright CI/CD](https://playwright.dev/docs/ci)
- [Azure Container Instances](https://docs.microsoft.com/en-us/azure/container-instances)
- [Azure Key Vault](https://docs.microsoft.com/en-us/azure/key-vault)

---

## ✅ Checklist

- [ ] Azure CLI installed
- [ ] Ran `azure-deploy.ps1` successfully
- [ ] Web App created
- [ ] Azure DevOps project created
- [ ] GitHub connected via service connection
- [ ] Pipeline created from YAML
- [ ] All variables set in Azure DevOps
- [ ] Test PR created
- [ ] Pipeline runs automatically
- [ ] Test results visible
- [ ] Jira updated with results

**You're ready to go!** 🚀
