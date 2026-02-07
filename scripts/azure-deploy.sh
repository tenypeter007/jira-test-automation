#!/bin/bash

# Azure Deployment Setup Script for Jira Test Automation
# This script sets up all required Azure resources and configurations

set -e

echo "=========================================="
echo "🚀 Azure Deployment Setup"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v az &> /dev/null; then
    echo -e "${RED}❌ Azure CLI not found. Please install it first:${NC}"
    echo "Visit: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites met${NC}"

# Login to Azure
echo -e "\n${YELLOW}Logging in to Azure...${NC}"
az login

# Set variables
read -p "Enter Azure subscription name (or leave blank for default): " SUBSCRIPTION
if [ -n "$SUBSCRIPTION" ]; then
    az account set --subscription "$SUBSCRIPTION"
fi

read -p "Enter resource group name [jira-automation-rg]: " RESOURCE_GROUP
RESOURCE_GROUP=${RESOURCE_GROUP:-jira-automation-rg}

read -p "Enter location [eastus]: " LOCATION
LOCATION=${LOCATION:-eastus}

read -p "Enter Container Registry name [jiraautomationacr]: " REGISTRY_NAME
REGISTRY_NAME=${REGISTRY_NAME:-jiraautomationacr}

read -p "Enter project name for Azure DevOps [jira-automation]: " PROJECT_NAME
PROJECT_NAME=${PROJECT_NAME:-jira-automation}

echo -e "\n${YELLOW}Configuration:${NC}"
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Registry: $REGISTRY_NAME"
echo "Project: $PROJECT_NAME"

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Create resource group
echo -e "\n${YELLOW}Creating resource group...${NC}"
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION"
echo -e "${GREEN}✅ Resource group created${NC}"

# Create Container Registry
echo -e "\n${YELLOW}Creating Azure Container Registry...${NC}"
az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$REGISTRY_NAME" \
    --sku Basic \
    --admin-enabled true
echo -e "${GREEN}✅ Container Registry created${NC}"

# Get registry credentials
echo -e "\n${YELLOW}Getting registry credentials...${NC}"
REGISTRY_URL=$(az acr show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$REGISTRY_NAME" \
    --query loginServer \
    --output tsv)

REGISTRY_USERNAME=$(az acr credential show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$REGISTRY_NAME" \
    --query "username" \
    --output tsv)

REGISTRY_PASSWORD=$(az acr credential show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$REGISTRY_NAME" \
    --query "passwords[0].value" \
    --output tsv)

echo -e "${GREEN}Registry URL: $REGISTRY_URL${NC}"

# Build and push Docker image
echo -e "\n${YELLOW}Building Docker image...${NC}"
az acr build \
    --registry "$REGISTRY_NAME" \
    --image jira-test-automation:latest \
    --file Dockerfile \
    .
echo -e "${GREEN}✅ Docker image built and pushed${NC}"

# Create Azure DevOps project (if needed)
echo -e "\n${YELLOW}Setting up Azure Pipelines...${NC}"
echo "Note: You'll need to:"
echo "1. Go to https://dev.azure.com and create/select an organization"
echo "2. Create a new project for this pipeline"
echo "3. Connect your GitHub repository"

# Create Key Vault for secrets
echo -e "\n${YELLOW}Creating Azure Key Vault for secrets...${NC}"
VAULT_NAME="${REGISTRY_NAME}-kv"
az keyvault create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VAULT_NAME" \
    --location "$LOCATION" \
    --enable-soft-delete false
echo -e "${GREEN}✅ Key Vault created${NC}"

# Add secrets to Key Vault
echo -e "\n${YELLOW}Enter your secrets (will be stored securely in Key Vault):${NC}"

read -p "JIRA_HOST: " JIRA_HOST
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "JIRA-HOST" \
    --value "$JIRA_HOST"

read -p "JIRA_EMAIL: " JIRA_EMAIL
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "JIRA-EMAIL" \
    --value "$JIRA_EMAIL"

read -s -p "JIRA_API_TOKEN: " JIRA_API_TOKEN
echo
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "JIRA-API-TOKEN" \
    --value "$JIRA_API_TOKEN"

read -s -p "ANTHROPIC_API_KEY: " ANTHROPIC_API_KEY
echo
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "ANTHROPIC-API-KEY" \
    --value "$ANTHROPIC_API_KEY"

read -s -p "GITHUB_TOKEN: " GITHUB_TOKEN
echo
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "GITHUB-TOKEN" \
    --value "$GITHUB_TOKEN"

read -p "GITHUB_USERNAME: " GITHUB_USERNAME
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "GITHUB-USERNAME" \
    --value "$GITHUB_USERNAME"

read -p "TARGET_REPO_URL: " TARGET_REPO_URL
az keyvault secret set \
    --vault-name "$VAULT_NAME" \
    --name "TARGET-REPO-URL" \
    --value "$TARGET_REPO_URL"

echo -e "${GREEN}✅ Secrets stored in Key Vault${NC}"

# Create App Service Plan
echo -e "\n${YELLOW}Creating App Service Plan...${NC}"
PLAN_NAME="${REGISTRY_NAME}-plan"
az appservice plan create \
    --name "$PLAN_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --sku B1 \
    --is-linux
echo -e "${GREEN}✅ App Service Plan created${NC}"

# Create Web App
echo -e "\n${YELLOW}Creating Web App...${NC}"
WEB_APP_NAME=$(echo "${REGISTRY_NAME}-app" | sed 's/[^a-zA-Z0-9-]//g')
az webapp create \
    --name "$WEB_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --plan "$PLAN_NAME" \
    --deployment-container-image-name-user "$REGISTRY_USERNAME" \
    --deployment-container-image-name-password "$REGISTRY_PASSWORD" \
    --docker-registry-server-url "https://$REGISTRY_URL"

echo -e "${GREEN}✅ Web App created: https://${WEB_APP_NAME}.azurewebsites.net${NC}"

# Configure web app settings
echo -e "\n${YELLOW}Configuring Web App...${NC}"
az webapp config appsettings set \
    --name "$WEB_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings \
        JIRA_HOST="$JIRA_HOST" \
        JIRA_EMAIL="$JIRA_EMAIL" \
        JIRA_API_TOKEN="$JIRA_API_TOKEN" \
        ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
        GITHUB_TOKEN="$GITHUB_TOKEN" \
        GITHUB_USERNAME="$GITHUB_USERNAME" \
        TARGET_REPO_URL="$TARGET_REPO_URL" \
        HEADED="true"

# Configure container
az webapp config container set \
    --name "$WEB_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --docker-custom-image-name "$REGISTRY_URL/jira-test-automation:latest" \
    --docker-registry-server-url "https://$REGISTRY_URL" \
    --docker-registry-server-user "$REGISTRY_USERNAME" \
    --docker-registry-server-password "$REGISTRY_PASSWORD"

echo -e "${GREEN}✅ Web App configured${NC}"

# Print summary
echo -e "\n${GREEN}=========================================="
echo "✅ Setup Complete!"
echo "==========================================${NC}"
echo -e "\n${YELLOW}Next Steps:${NC}"
echo "1. Push code to GitHub:"
echo "   git push origin main"
echo ""
echo "2. Set up Azure Pipelines:"
echo "   - Go to https://dev.azure.com"
echo "   - Create a new project"
echo "   - Create a pipeline from 'azure-pipelines.yml'"
echo "   - Add pipeline variables in Azure DevOps:"
echo "     * AZURE_SUBSCRIPTION"
echo "     * AZURE_REGISTRY_CONNECTION"
echo "     * AZURE_REGISTRY_NAME"
echo "     * AZURE_RESOURCE_GROUP"
echo "     * JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN"
echo "     * ANTHROPIC_API_KEY"
echo "     * GITHUB_TOKEN, GITHUB_USERNAME"
echo "     * TARGET_REPO_URL"
echo ""
echo "3. Monitor tests:"
echo -e "   Web App URL: ${YELLOW}https://${WEB_APP_NAME}.azurewebsites.net${NC}"
echo ""
echo "4. View logs:"
echo "   az webapp log tail --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
echo "📊 Resource Summary:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Registry: $REGISTRY_URL"
echo "   Key Vault: $VAULT_NAME"
echo "   Web App: $WEB_APP_NAME"
echo "   App Service Plan: $PLAN_NAME"
