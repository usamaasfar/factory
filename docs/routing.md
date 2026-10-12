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

Content delivery happens after routing, using the returned session IDs.

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
Pi Durable owns agent execution and conversation persistence.
