# Azure deployment status

The previous guide referenced `scripts/azure-deploy.ps1` and Azure pipeline files that do not exist in this repository. It should not be used as an executable deployment procedure.

Use the tested local setup in [README.md](README.md) first. This repository supplies a Dockerfile and local Compose configuration; it does not provision Azure infrastructure.

An Azure deployment needs a container host supporting browser execution and sufficient disk/memory, secret injection for `.env.example` values, `HOST=0.0.0.0`, a nonempty `API_TOKEN`, HTTPS ingress, persistent report storage, and outbound Jira/Claude/GitHub access. Jobs are in memory, so restarts do not resume work. Azure provisioning and deployment have not been verified.
