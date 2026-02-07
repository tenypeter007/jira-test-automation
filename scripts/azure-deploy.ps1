# Azure Deployment Setup Script for Jira Test Automation (PowerShell)
# This script sets up all required Azure resources and configurations

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "🚀 Azure Deployment Setup (PowerShell)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# Check prerequisites
Write-Host "`nChecking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Azure CLI not found. Please install it first:" -ForegroundColor Red
    Write-Host "Download: https://aka.ms/installazurecliwindows"
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git not found" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Prerequisites met" -ForegroundColor Green

# Login to Azure
Write-Host "`nLogging in to Azure..." -ForegroundColor Yellow
az login

# Set variables
$RESOURCE_GROUP = Read-Host "Enter resource group name [jira-automation-rg]"
if ([string]::IsNullOrWhiteSpace($RESOURCE_GROUP)) { $RESOURCE_GROUP = "jira-automation-rg" }

$LOCATION = Read-Host "Enter location [eastus]"
if ([string]::IsNullOrWhiteSpace($LOCATION)) { $LOCATION = "eastus" }

$REGISTRY_NAME = Read-Host "Enter Container Registry name [jiraautomationacr]"
if ([string]::IsNullOrWhiteSpace($REGISTRY_NAME)) { $REGISTRY_NAME = "jiraautomationacr" }

$PROJECT_NAME = Read-Host "Enter project name for Azure DevOps [jira-automation]"
if ([string]::IsNullOrWhiteSpace($PROJECT_NAME)) { $PROJECT_NAME = "jira-automation" }

Write-Host "`nConfiguration:" -ForegroundColor Yellow
Write-Host "Resource Group: $RESOURCE_GROUP"
Write-Host "Location: $LOCATION"
Write-Host "Registry: $REGISTRY_NAME"
Write-Host "Project: $PROJECT_NAME"

$confirm = Read-Host "Continue? (y/n)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    exit 1
}

# Create resource group
Write-Host "`nCreating resource group..." -ForegroundColor Yellow
az group create --name $RESOURCE_GROUP --location $LOCATION
Write-Host "✅ Resource group created" -ForegroundColor Green

# Create Container Registry
Write-Host "`nCreating Azure Container Registry..." -ForegroundColor Yellow
az acr create `
    --resource-group $RESOURCE_GROUP `
    --name $REGISTRY_NAME `
    --sku Basic `
    --admin-enabled true
Write-Host "✅ Container Registry created" -ForegroundColor Green

# Get registry credentials
Write-Host "`nGetting registry credentials..." -ForegroundColor Yellow
$REGISTRY_URL = az acr show `
    --resource-group $RESOURCE_GROUP `
    --name $REGISTRY_NAME `
    --query loginServer `
    --output tsv

$REGISTRY_USERNAME = az acr credential show `
    --resource-group $RESOURCE_GROUP `
    --name $REGISTRY_NAME `
    --query "username" `
    --output tsv

$REGISTRY_PASSWORD = az acr credential show `
    --resource-group $RESOURCE_GROUP `
    --name $REGISTRY_NAME `
    --query "passwords[0].value" `
    --output tsv

Write-Host "Registry URL: $REGISTRY_URL" -ForegroundColor Green

# Build and push Docker image
Write-Host "`nBuilding and pushing Docker image..." -ForegroundColor Yellow
az acr build `
    --registry $REGISTRY_NAME `
    --image jira-test-automation:latest `
    --file Dockerfile `
    .
Write-Host "✅ Docker image built and pushed" -ForegroundColor Green

# Create Key Vault for secrets
Write-Host "`nCreating Azure Key Vault for secrets..." -ForegroundColor Yellow
$VAULT_NAME = "$REGISTRY_NAME-kv"
az keyvault create `
    --resource-group $RESOURCE_GROUP `
    --name $VAULT_NAME `
    --location $LOCATION `
    --enable-soft-delete false
Write-Host "✅ Key Vault created" -ForegroundColor Green

# Add secrets to Key Vault
Write-Host "`nEnter your secrets (will be stored securely in Key Vault):" -ForegroundColor Yellow

$JIRA_HOST = Read-Host "JIRA_HOST"
az keyvault secret set --vault-name $VAULT_NAME --name "JIRA-HOST" --value $JIRA_HOST

$JIRA_EMAIL = Read-Host "JIRA_EMAIL"
az keyvault secret set --vault-name $VAULT_NAME --name "JIRA-EMAIL" --value $JIRA_EMAIL

$JIRA_API_TOKEN = Read-Host "JIRA_API_TOKEN (hidden)" -AsSecureString
$JIRA_API_TOKEN_PLAIN = [System.Net.NetworkCredential]::new('', $JIRA_API_TOKEN).Password
az keyvault secret set --vault-name $VAULT_NAME --name "JIRA-API-TOKEN" --value $JIRA_API_TOKEN_PLAIN

$ANTHROPIC_API_KEY = Read-Host "ANTHROPIC_API_KEY (hidden)" -AsSecureString
$ANTHROPIC_API_KEY_PLAIN = [System.Net.NetworkCredential]::new('', $ANTHROPIC_API_KEY).Password
az keyvault secret set --vault-name $VAULT_NAME --name "ANTHROPIC-API-KEY" --value $ANTHROPIC_API_KEY_PLAIN

$GITHUB_TOKEN = Read-Host "GITHUB_TOKEN (hidden)" -AsSecureString
$GITHUB_TOKEN_PLAIN = [System.Net.NetworkCredential]::new('', $GITHUB_TOKEN).Password
az keyvault secret set --vault-name $VAULT_NAME --name "GITHUB-TOKEN" --value $GITHUB_TOKEN_PLAIN

$GITHUB_USERNAME = Read-Host "GITHUB_USERNAME"
az keyvault secret set --vault-name $VAULT_NAME --name "GITHUB-USERNAME" --value $GITHUB_USERNAME

$TARGET_REPO_URL = Read-Host "TARGET_REPO_URL"
az keyvault secret set --vault-name $VAULT_NAME --name "TARGET-REPO-URL" --value $TARGET_REPO_URL

Write-Host "✅ Secrets stored in Key Vault" -ForegroundColor Green

# Create App Service Plan
Write-Host "`nCreating App Service Plan..." -ForegroundColor Yellow
$PLAN_NAME = "$REGISTRY_NAME-plan"
az appservice plan create `
    --name $PLAN_NAME `
    --resource-group $RESOURCE_GROUP `
    --sku B1 `
    --is-linux
Write-Host "✅ App Service Plan created" -ForegroundColor Green

# Create Web App
Write-Host "`nCreating Web App..." -ForegroundColor Yellow
$WEB_APP_NAME = $REGISTRY_NAME + "-app"
az webapp create `
    --name $WEB_APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --plan $PLAN_NAME `
    --deployment-container-image-name-user $REGISTRY_USERNAME `
    --deployment-container-image-name-password $REGISTRY_PASSWORD `
    --docker-registry-server-url "https://$REGISTRY_URL"

Write-Host "✅ Web App created: https://$WEB_APP_NAME.azurewebsites.net" -ForegroundColor Green

# Configure web app settings
Write-Host "`nConfiguring Web App..." -ForegroundColor Yellow
az webapp config appsettings set `
    --name $WEB_APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --settings `
        JIRA_HOST="$JIRA_HOST" `
        JIRA_EMAIL="$JIRA_EMAIL" `
        JIRA_API_TOKEN="$JIRA_API_TOKEN_PLAIN" `
        ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY_PLAIN" `
        GITHUB_TOKEN="$GITHUB_TOKEN_PLAIN" `
        GITHUB_USERNAME="$GITHUB_USERNAME" `
        TARGET_REPO_URL="$TARGET_REPO_URL" `
        HEADED="true"

# Configure container
az webapp config container set `
    --name $WEB_APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --docker-custom-image-name "$REGISTRY_URL/jira-test-automation:latest" `
    --docker-registry-server-url "https://$REGISTRY_URL" `
    --docker-registry-server-user $REGISTRY_USERNAME `
    --docker-registry-server-password $REGISTRY_PASSWORD

Write-Host "✅ Web App configured" -ForegroundColor Green

# Print summary
Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "1. Push code to GitHub:"
Write-Host "   git push origin main"
Write-Host ""
Write-Host "2. Set up Azure Pipelines:"
Write-Host "   - Go to https://dev.azure.com"
Write-Host "   - Create a new project"
Write-Host "   - Create a pipeline from 'azure-pipelines.yml'"
Write-Host "   - Add pipeline variables in Azure DevOps:"
Write-Host "     * AZURE_SUBSCRIPTION"
Write-Host "     * AZURE_REGISTRY_CONNECTION"
Write-Host "     * AZURE_REGISTRY_NAME"
Write-Host "     * AZURE_RESOURCE_GROUP"
Write-Host "     * JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN"
Write-Host "     * ANTHROPIC_API_KEY"
Write-Host "     * GITHUB_TOKEN, GITHUB_USERNAME"
Write-Host "     * TARGET_REPO_URL"
Write-Host ""
Write-Host "3. Monitor tests:"
Write-Host "   Web App URL: https://$WEB_APP_NAME.azurewebsites.net"
Write-Host ""
Write-Host "4. View logs:"
Write-Host "   az webapp log tail --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP"
Write-Host ""
Write-Host "📊 Resource Summary:" -ForegroundColor Yellow
Write-Host "   Resource Group: $RESOURCE_GROUP"
Write-Host "   Registry: $REGISTRY_URL"
Write-Host "   Key Vault: $VAULT_NAME"
Write-Host "   Web App: $WEB_APP_NAME"
Write-Host "   App Service Plan: $PLAN_NAME"

Write-Host "`n✅ Configuration saved. You can now set up Azure Pipelines!" -ForegroundColor Green
