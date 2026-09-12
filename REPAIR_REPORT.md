# Project analysis and repair

Repository: https://github.com/tenypeter007/jira-test-automation

Starting commit: `201b112b442decc8a8bd5a94ff1c5e531cc4807e`

Local branch: `fix/working-automation-pipeline`

## Findings and changes

| Original problem | Repair |
| --- | --- |
| `npm start` was absent, `npm test` always failed, and startup imported undeclared Playwright | Added start/test/smoke commands; removed unused browser import; lazy provider initialization allows health checks before credentials exist |
| Agent 1 called Agent 2, while the server also called Agent 2 | Single sequential orchestrator; each agent returns its output and runs once |
| Manual calls used fake issues without `fields`; Jira document descriptions caused string-method errors | Fetch real issues through Jira REST; convert Atlassian Document Format to text |
| Producer wrote `scenarios` but server read `testCases` | Normalize both formats; reject empty data |
| Agent 2 returned no PR details; server guessed a `/pulls` URL | Return actual draft PR URL, branch, and commit SHA |
| Shared `temp-repo` was deleted by both agents and concurrent jobs | Create separate unique directories per stage/job and reject duplicate active issue requests |
| Agent 3 cloned the default branch, never testing the generated commit | Resolve the PR head, fetch its ref, verify the exact SHA and check it out |
| Generation assumed repository APIs without reading them | Read tracked target test files/configuration into generation context |
| AI-generated paths only received prefix checks | Strict path/file validation, duplicate checks, symlink rejection and `.only()` protection |
| Git credentials were stored in remote URLs | Supply Git authentication through process environment; keep clean remote URLs |
| PR base branch was hardcoded to `main` | Read repository metadata for its actual default branch |
| Tests were always headed, dependency errors were ignored, JSON output path was not configured | Default headless, propagate install errors, configure JSON output and disable automatic HTML report serving |
| Parser assumed `suite.tests` instead of nested `suites/specs/tests` | Count actual Playwright report entries, including projects, retries and skips |
| Missing reports/zero tests could produce success | Reject missing, malformed, empty/all-skipped, setup-error and inconsistent exit-code results |
| Server swallowed workflow errors and provided no result retrieval | HTTP 202 jobs with status URLs and explicit failure states; CLI exits nonzero on failure |
| Jira status update used the ignored `status` key | Use optional configured transitions and case-insensitive status matching |
| Jira comments/status updates could retrigger automation | Trigger webhooks only for issue creation and summary/description changes |
| Unsafe selector correction guessed from static HTML and could rewrite unrelated code | Removed automatic rewriting; failed tests remain failed for review |
| No lockfile; obsolete HTTP dependency tree had audit findings | Track lockfile, use Axios for Jira REST, and override the affected qs dependency; final audit reported zero vulnerabilities |
| CI tested an unrelated repository and did not validate this application | Add Windows/Linux regression and browser smoke jobs |
| Docker used a floating image, copied potential credentials, and assumed a display | Pin browser image, exclude secrets, use headless mode and validate Compose configuration |
| Azure guide referenced missing scripts | Replace it with an explicit deployment-status note |

## Verification performed locally

- `npm test`: **17 passed, 0 failed**.
- Provider integration test: actual Anthropic SDK requests handled by a local HTTP stub; Jira REST calls intercepted by an Axios adapter. Confirms document text, JSON parsing, persisted scenarios, comments and transitions without contacting accounts.
- `npm run test:smoke`: **passed** using real Chromium. Verified form interaction; reran with one passing and one intentionally failing test and confirmed failure reporting.
- `npm audit`: installation's final audit reported **0 vulnerabilities**.
- `docker compose -f docker-compose.test.yml config --quiet`: **passed**, using a temporary validation token.
- `git diff --check`: **passed**.
- `npm start`: **running** at http://127.0.0.1:3000 during delivery.
- `GET /health`: **healthy**.
- CLI without required credentials: exits with an actionable missing-configuration message.

The smoke artifacts are retained under `work/smoke-*/`. The intentionally failing test in its final HTML report is part of validating the executor, not a failed smoke command.

## Remaining external setup

An ignored `.env` file has been created from `.env.example`. Fill in Jira credentials, the Claude key and model, a GitHub token, and the target repository URL to enable live jobs. A full workflow posts Jira comments, creates a draft PR in the target repository and executes its tests.

Live account authentication, generated test quality on the real application, and the application's GitHub push/PR operations have **not** been verified. No Jira messages were sent during validation. The repair is published separately on `fix/working-automation-pipeline`; the application's live workflow still requires the configuration above.

Docker build/runtime was **not** verified because the Docker Desktop Linux engine is unavailable. CI configuration was updated but has not run remotely. Azure deployment was not attempted.

This service retains jobs in memory and runs generated code as its service account. Use an isolated worker for trusted repositories. Reports/checkouts are kept for diagnosis and require periodic cleanup.

## References checked

- [Playwright reporters](https://playwright.dev/docs/test-reporters): explicit JSON file output and HTML report behavior.
- [Claude models](https://platform.claude.com/docs/en/models/overview): configurable model ID and current default selection.
