# Factory architecture

Factory is a self-hosted workflow engine that turns provider events into long-lived agent
conversations running in isolated Docker sandboxes. The first working provider is GitHub: a
pull request becomes one durable conversation that reviews the code, discusses it, and can
publish its own commits back to the branch.

## Topology

Everything splits across two trust domains.

**Trusted host** runs the control plane:

- Hono HTTP boundary
- Factory SQLite database (routing and workflow registry)
- Pi Durable harness and storage (agent conversations)
- GitHub App authentication and the Octokit REST client
- Repository cloning and publishing through the host `git` binary
- Docker CLI, which manages disposable containers

**Sandbox** is a disposable Docker container per conversation:

- Persistent named volume mounted at `/workspace`
- Read-only root filesystem, writable `/tmp` tmpfs
- All capabilities dropped, `no-new-privileges`, `--init`
- No credentials, tokens, Docker socket, or authenticated Git remote

Model execution stays on the host; only the coding tools' filesystem and shell operations run
inside the container.

## Components

```
src/index.ts                              composition root (Bun)
src/server.ts                             Hono HTTP boundary
src/database.ts / database-schema.ts      Factory SQLite + Drizzle
src/workflows.ts                          strict workflow DSL (Zod)
src/workflow-registration.ts              trusted default-branch registration
src/workflow-registry.ts                  atomic registry replacement and matching
src/workflow-sessions.ts                  durable sessions keyed by provider subject
src/workflow-runner.ts                    conversation acquisition and submission
src/durable.ts                            Pi Durable harness + sandbox wiring
src/git.ts                                trusted host Git transport
src/sandbox/                              Docker sandbox and Pi ExecutionEnv
src/integrations/github/                  GitHub provider: webhooks, tools, handler
```

## Data flow

A signed GitHub webhook travels one pipeline.

```text
POST /webhooks/github
  → receiveGitHubWebhook            verify signature, parse into a typed event
  → handleGitHubEvent               GitHub orchestration
      → registerGitHubWorkflows     default-branch push updates the registry
      → findRegisteredWorkflows     match github.<event> against the registry
      → resolveGitHubPullRequestTarget   current PR head, branch, repo IDs
      → createGitHubTools           repository-scoped tool extension + publish tool
      → findOrCreateWorkflowSession session per workflow path + PR route
      → openWorkflowConversation    one ownerless Pi conversation per session
      → prepareGitHubWorkspace      clone exact PR head, replace the volume
      → configureGitAuthor          bot identity in the checkout's Git config
      → submitWorkflowEvent         durably admit the factual event, whenBusy "steer"
  → 202 Accepted
```

The agent run itself is asynchronous and owned by Pi Durable. The webhook handler admits the
event; it does not wait for the model to finish.

### Registration is trusted

Only `push` events on the repository's default branch can change registered workflows. The
registration snapshot is read at the exact pushed head and atomically replaces the previous
snapshot in one transaction. `installation.created` and `installation_repositories.added`
bootstrap repositories before their first push. A pull request therefore cannot change the
instructions governing its own review.

### One session, one conversation

A workflow session is keyed by repository, workflow path, and provider subject. For GitHub,
the subject is `repository:<id>:pull_request:<number>`, so every event family for a PR —
opened, synchronize, ordinary comments, reviews, and inline review comments — resolves to the
same session and the same Pi conversation. The session snapshots the workflow definition and
revision at creation time, so later workflow updates do not rewrite an active session.

The Pi conversation is ownerless: its lifetime belongs to the external subject. Factory stores
the conversation ID on the session and reopens that conversation for subsequent events.
Delivery IDs become Pi `requestId` values, deduplicating redeliveries, and `whenBusy:
"steer"` injects new events into an already-running conversation at a safe boundary.

### Workspace preparation

Before the event reaches the model, Factory ensures the conversation's `/workspace` volume
contains the exact PR head:

- `GitHubRepository.clone()` runs on the host with an ephemeral installation token.
- The authenticated `origin` remote is removed immediately after checkout.
- A short-lived helper container replaces the named volume's contents (the hardened agent
  container cannot delete host-owned files).
- If the expected revision is already an ancestor of the volume's `HEAD`, the volume is kept
  as-is, preserving agent commits and other in-progress work.

### GitHub tools

The curated GitHub tool set (actions, checks, issues, pulls, reactions, search, users) is
built per event with a repository-scoped Octokit client and installed under the extension name
`github`. Installing by name replaces the previous instance, so each event carries fresh
credentials for its installation.

A single host-only capability, `github_publish_changes`, is the only way agent work reaches
the remote:

1. The sandbox verifies the expected head is an ancestor of its `HEAD`, normalizes the tip
   commit's author to the bot identity if needed, and exports a Git bundle.
2. The host clones the PR branch, verifies the bundle, fetches it, confirms the remote head
   still matches the expected head, and requires fast-forward ancestry.
3. The host pushes without force and returns the new head.

The sandbox never sees the token; publishing is host-mediated.

### Bot attribution

Factory resolves the configured GitHub App bot account (`GITHUB_APP_LOGIN`) to its numeric
account ID and derives the verified noreply email. The checkout's Git config and the bundle
export both use that identity, so agent-authored commits appear under the bot's avatar even if
the model supplies its own author name.

## Data model

```text
repositories          one row per installed repository (provider, providerId, default branch)
workflows             registered workflow files (path, source, validated definition)
workflow_sessions     durable session → workflow snapshot, conversation ID, origin route
workflow_session_routes   provider subjects mapped to sessions (extra routes for later providers)
```

Factory routing lives in `factory.sqlite`. Pi Durable owns its own SQLite storage in
`pi.sqlite`; Factory never reimplements conversations, queues, steering, retries, or recovery.

## Security boundaries

- Credentials stay on the host: tokens never enter the sandbox, Git URLs, Git config, or the
  model context.
- The sandbox has no network credentials and no Docker socket.
- Publishing requires the remote head to be unchanged, the new head to be a fast-forward, and
  no force push.
- Fork-origin pull requests are rejected for publishing (their branch is not writable by the
  installation).
- Workflow definitions come only from the trusted default branch and must pass the strict DSL.

## Configuration

```text
GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
GITHUB_APP_LOGIN        bot login, e.g. usamaasfar[bot]
DATABASE_PATH           .factory/state/factory.sqlite
PI_DATABASE_PATH        .factory/state/pi.sqlite
SANDBOX_IMAGE           Docker image for the sandbox (default debian:bookworm-slim)
PORT                    default 8080
```

The sandbox image must include Git (and Bun for Bun-based repositories); the default
`debian:bookworm-slim` image does not. The workflow DSL validates `agent.environment` and
`agent.resources`, but per-workflow image building from `.factory/environments/*.linux` is not
yet wired into execution — `SANDBOX_IMAGE` currently selects the image for every conversation.
