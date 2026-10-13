# Event routing

Workflow triggers start sessions; event subjects determine which sessions receive
subsequent events.

## Rules

- An event matching a workflow's `on` creates a session if none exists for that
  workflow and subject.
- The triggering event's subject becomes the session's routing scope.
- Events with an equal subject or a descendant subject are delivered to every
  matching session.
- Matching uses complete path segments, not raw string prefixes.
- An event is delivered only once per session, even if it also matches `on`.
- Permissions control tool access, not event routing.

## Flow

```text
Event
  |
  +--> Matching sessions ----------------------+
  |                                           |
  +--> Workflows matching `on`                 |
         |                                    |
         +--> Session already matched? Skip    |
         |                                    |
         +--> Create conversation              |
                |                             |
                +--> Save session ------------+
                                              |
                                              v
                                    Return session IDs
```

`workflowRouter()` returns session IDs without submitting content.
`workflowTrigger()` loads each session's conversation and submits the event to it,
returning `{ sessionId, submissionId }` for each target. No route and no matching
trigger produces an empty result.

## Agent input

New conversations store the workflow's model provider, model ID, and instructions.
Later events reuse the conversation and its history rather than reconfiguring it.
Input is submitted with `whenBusy: "steer"`: an idle conversation starts a run;
a busy conversation receives the input at a Durable steering boundary. This does
not interrupt an in-flight model request.

The namespaced delivery ID becomes Durable's `requestId`. Retrying that ID in the
same conversation returns the existing submission. Subjects identify resources,
not individual deliveries, and must not be used as request IDs.

Triggering waits for admission, not completion. Call `submission.wait()` when a
caller needs the answer; a run can settle as `unanswered` even after successful
admission. Resolved webhook events reach the trigger through the callback wired
at startup; see [extensibility](extensibility.md#webhook-delivery).

## Subjects

Integrations provide consistently namespaced subjects, ordered from parent to
child resource. Subjects identify resources; event IDs identify deliveries for
deduplication, and content supplies the agent's input.

For example, a session started by `github.pull_request.opened` has this scope:

```text
github:repository:123:pull_request:42
```

These subjects route to that session:

```text
github:repository:123:pull_request:42
github:repository:123:pull_request:42:comment:100
github:repository:123:pull_request:42:review_comment:200:reply:201
```

Subjects for PR `43` or `420` do not match. If a review-thread session also
matches a reply, both it and the PR session receive the event.

## Ownership

Integrations construct subjects. Factory matches triggers, maintains session
routing scopes, and delivers content to the associated Pi Durable conversations.
Pi Durable owns agent execution and conversation state. The current harness uses
memory storage, so history and unfinished runs do not survive a process restart.
