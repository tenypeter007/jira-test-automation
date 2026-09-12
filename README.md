# Jira Test Automation

An Express service that fetches Jira issues, generates test scenarios and Playwright code with Claude, opens a draft GitHub PR, and executes the exact PR commit. Each stage runs once, errors stop the pipeline, and jobs expose their results through the API.

## Local setup

Requires Node.js 22+, npm, and Git.

```sh
npm ci
npm start
```

The server starts at http://127.0.0.1:3000 without credentials. `GET /health` checks server availability, not provider connectivity. Running an agent requires the configuration below.

Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`) and fill in:

| Variable | Purpose |
| --- | --- |
| `JIRA_HOST` | Jira Cloud hostname, e.g. your-instance.atlassian.net |
| `JIRA_EMAIL`, `JIRA_API_TOKEN` | Account with issue read/comment access |
| `ANTHROPIC_API_KEY` | Claude API credentials |
| `ANTHROPIC_MODEL` | Model ID; defaults to `claude-sonnet-5` |
| `TARGET_REPO_URL` | HTTPS GitHub URL of the existing Playwright repository |
| `GITHUB_TOKEN` | Token with access to repository contents and pull requests |
| `API_TOKEN` | Bearer token for API calls; required when binding beyond loopback |
| `HOST`, `PORT` | Defaults: 127.0.0.1 and 3000 |
| `HEADED` | `false` by default; use `true` only with a working display |
| `JIRA_SUCCESS_STATUS`, `JIRA_FAILURE_STATUS` | Optional Jira destination statuses; blank preserves the issue status |

Do not commit `.env`. The Docker build excludes it. Git authentication is passed through process environment configuration, rather than persisted in clone URLs.

The target repository must contain a working Playwright configuration and `@playwright/test` dependency, preferably with a lockfile. The generator reads existing test/page files to learn their imports and APIs. It supports `tests/pages/*.ts`, `tests/{e2e,ui,visual}/*.spec.ts`, and `tests/testdata.ts`. It cannot create or replace `BasePage.ts` or framework configuration. Review generated selectors and assertions before merging.

## Run agents

Run the full pipeline once and exit:

```sh
npm start -- --issue SCRUM-6
```

Run individual stages:

```sh
npm start -- --issue SCRUM-6 --agent 1
npm start -- --issue SCRUM-6 --agent 2
npm start -- --issue SCRUM-6 --agent 3 --pr https://github.com/OWNER/REPO/pull/123
```

Agent 1 writes `shared/test-cases/SCRUM-6-test-cases.json`. Agent 2 reads that file for standalone execution and returns the draft PR URL and commit SHA. Agent 3 requires a PR URL; it fetches and verifies the PR head instead of running the default branch. Failed tests make the CLI exit with code 1.

Directly running `agents/.../index.js` does not start a job; use the CLI above.

## HTTP API

Send JSON with `Content-Type: application/json`. When `API_TOKEN` is configured, also send `Authorization: Bearer YOUR_TOKEN`.

| Method | Endpoint | Body |
| --- | --- | --- |
| GET | `/health` | None; no authentication needed |
| POST | `/generate-tests` or `/agents/all` | `{"issueKey":"SCRUM-6"}` |
| POST | `/agent/1` or `/agents/1` | `{"issueKey":"SCRUM-6"}` |
| POST | `/agent/2` or `/agents/2` | `{"issueKey":"SCRUM-6"}` |
| POST | `/agent/3` or `/agents/3` | `{"issueKey":"SCRUM-6","prUrl":"https://github.com/OWNER/REPO/pull/123"}` |
| GET | `/jobs/:id` | None |
| POST | `/jira-webhook` | Jira event payload |

Example in PowerShell, with the server running in another terminal:

```powershell
$job = Invoke-RestMethod http://127.0.0.1:3000/generate-tests -Method Post -ContentType application/json -Body '{"issueKey":"SCRUM-6"}'
Invoke-RestMethod ("http://127.0.0.1:3000" + $job.statusUrl)
```

Accepted jobs return HTTP 202 and a `statusUrl`. Poll it for `queued`, `running`, `completed`, or `failed`, including the result or error. Invalid input returns 400; missing configuration returns 503; duplicate active issue jobs return 409. There are at most four concurrent jobs. The latest 100 jobs are retained in memory and lost on restart.

Webhooks trigger only for `jira:issue_created` or summary/description changes in `jira:issue_updated`. Comment and status updates are ignored to avoid feedback loops. Configure the sender to include the bearer header (for example, an authenticated Jira Automation web request). Event retries after a completed job can trigger another run; durable event deduplication is not implemented.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:smoke
```

The regression suite uses local fixtures and stubs, without external credentials. The smoke test launches real Chromium, fills a local form, then adds an intentional failing assertion and confirms the executor reports failure. Its command exits successfully when both checks work. Reports are saved beneath `work/smoke-*/`.

GitHub Actions runs these checks on Windows and Linux. It tests this framework, without cloning or testing an unrelated default repository.

The JSON reporter is configured to write a file explicitly. Nested suites, per-project results, skips and flaky retries are counted. Missing reports, setup errors and empty/all-skipped suites cannot count as success. See [Playwright reporter documentation](https://playwright.dev/docs/test-reporters).

## Docker

Set a nonempty `API_TOKEN` in `.env`, then:

```sh
docker compose -f docker-compose.test.yml up --build
```

The image pins Playwright 1.58.2 and defaults to headless operation. The executor installs the target repository dependencies and matching browsers. Linux host installations outside Docker need Playwright system dependencies installed separately. Target configurations that require other services or credentials must be configured for the execution environment.

## Limits and review

- Live generation needs valid Jira, Claude and GitHub access. A passing local regression suite does not verify those accounts or the quality of generated tests.
- Generated code is executed with the service account's privileges. Run only trusted target repositories in an isolated worker/container; the server is not a multi-tenant sandbox.
- The previous automatic selector-rewriting implementation was removed: it inferred selectors from unauthenticated static HTML, could edit the wrong file, and did not reliably verify its corrections. Failed tests now remain failed for review.
- Execution reports remain in each unique `temp-repo/` checkout. Archive or remove old checkouts when no job is using them. They are retained for diagnosis, not automatically published or attached to Jira.
- Claude's default model can be overridden using `ANTHROPIC_MODEL`; verify model availability for your account in the [Claude model documentation](https://platform.claude.com/docs/en/models/overview).

See `REPAIR_REPORT.md` for the repaired defects and verification performed.
