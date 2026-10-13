# Integrations

Provider adapters built on `factory-oss/integration`. Each adapter creates an
authenticated client, registers a webhook handler, and returns event definitions
and tool resources.

Startup discovers `integrations/*/index.ts`; see
[configuration and startup](../docs/extensibility.md#configuration-and-startup).
The API dispatches raw requests at `POST /webhook/:integration` to the
registered handler. Workflow permissions select resource tools for each Durable
conversation.

## GitHub

The GitHub adapter is scoped to one app installation and repository. It supports pull request, review, review-comment, review-thread, issue-comment, and reaction workflows. Ordinary issue comments are ignored; this slice is intentionally pull-request-only.

Configuration:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_INSTALLATION_ID`
- `GITHUB_REPOSITORY_ID`

Webhook deliveries are signature-verified and filtered to the configured installation and repository.

## Slack

The Slack adapter supports app mentions and user replies in public and private channel threads. Its tools read a thread and post a threaded reply.

Configuration:

- `SLACK_TOKEN`
- `SLACK_SIGNING_SECRET`

The Slack app must subscribe to `app_mention`, `message.channels`, and `message.groups`. Its token must be permitted to call `conversations.replies` and `chat.postMessage`. Webhook requests are signature-verified and checked for freshness. The signed payload supplies the workspace identity. Bot messages, message subtypes, and non-thread channel messages are ignored.

## Linear

The Linear adapter supports issue triage across issue creation, issue updates, and issue comments. Its tools read an issue and discussion, search related issues, list team triage options, update triage fields, and post comments.

Configuration:

- `LINEAR_API_KEY`
- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_ORGANIZATION_ID`

The Linear webhook must subscribe to `Issue` and `Comment` resources. Deliveries are verified with Linear's webhook client and filtered to the configured organization. Comments unrelated to an issue are ignored.

## Runtime behavior

Subjects follow [event routing](../docs/routing.md): resource ancestry paths
ordered from parent to child, using stable IDs only. The integration registry
supplies the provider namespace; subjects do not repeat it. For example:

- `repository:123:pull_request:42:comment:100`
- `repository:123:pull_request:42:review_comment:200:reply:201`
- `workspace:T1:channel:C1:thread:1700000000.001:reply:1700000001.002`
- `organization:org-id:issue:issue-id:comment:comment-id:reply:reply-id`

Slack uses `thread_ts` (or the root message's `ts`) as the thread identity and
each reply's `ts` as its identity. Mentions and messages use the same paths.
Linear replies use the supplied `parentId`; GitHub review-comment replies use
`in_reply_to_id`. No extra ancestors are inferred. GitHub review-thread events
use `review_thread:<node_id>` under the PR, separate from `review_comment:<id>`:
comment deliveries do not supply that thread node ID, so these adapters do not
invent a mapping between thread and comment identities.

Action names and agent-facing text stay outside subjects. Delivery IDs remain
separate for Factory's deduplication. These adapters do not implement routing
or change tool permissions.

Provider payloads remain private to their adapter. Verified deliveries are reduced to a stable subject and short factual content before Factory handles them. Tool failures return concise agent-facing content; cancellation remains control flow. Mutating tools are marked replay-unsafe.
