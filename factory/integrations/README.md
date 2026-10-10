# Integrations

Experimental provider adapters built on `factory-oss/integration`. Each adapter creates one authenticated client, registers verified webhook events, and exposes provider-specific tools. They are not connected to the legacy runtime under `src/`.

## GitHub

The GitHub adapter is scoped to one app installation and repository. It supports pull request, review, review-comment, review-thread, issue-comment, and reaction workflows. Ordinary issue comments are ignored; this slice is intentionally pull-request-only.

Configuration:

- `appId`
- `privateKey`
- `webhookSecret`
- `installationId`
- `repositoryId`

Webhook deliveries are signature-verified and filtered to the configured installation and repository.

## Slack

The Slack adapter supports app mentions and user replies in public and private channel threads. Its tools read a thread and post a threaded reply.

Configuration:

- `token`
- `signingSecret`
- `teamId`

The Slack app must subscribe to `app_mention`, `message.channels`, and `message.groups`. Its token must be permitted to call `conversations.replies` and `chat.postMessage`. Webhook requests are signature-verified, checked for freshness, and filtered to the configured workspace. Bot messages, message subtypes, and non-thread channel messages are ignored.

## Linear

The Linear adapter supports issue triage across issue creation, issue updates, and issue comments. Its tools read an issue and discussion, search related issues, list team triage options, update triage fields, and post comments.

Configuration:

- `apiKey`
- `webhookSecret`
- `organizationId`

The Linear webhook must subscribe to `Issue` and `Comment` resources. Deliveries are verified with Linear's webhook client and filtered to the configured organization. Comments unrelated to an issue are ignored.

## Runtime behavior

Provider payloads remain private to their adapter. Verified deliveries are reduced to a stable subject and short factual content before Factory handles them. Tool failures return concise agent-facing content; cancellation remains control flow. Mutating tools are marked replay-unsafe.
