# Workflow

The workflow layer turns trusted definitions and external events into long-lived
agent conversations. Provider integrations translate their native APIs into
this layer; workflow code does not parse webhooks or authenticate to providers.

The current matching model is repository-scoped because GitHub is the first
integration. It is internal and transitional, not the future public integration
protocol. See `../integrations/README.md` for the protocol design boundary.

```text
trusted repository snapshot ──→ WorkflowStore
                                      │ match
provider event ──→ WorkflowRuntime ───┤
                                      ▼
                            session → conversation → workspace
```

## Boundaries

The workflow layer owns:

- strict definition parsing and normalized definitions;
- atomic registration snapshots;
- matching provider-neutral events to registrations;
- stable session and conversation identity;
- event admission and workspace suspension after conversations become idle.

Provider integrations own:

- webhook verification and native payload types;
- discovering trusted workflow files;
- provider event names, subjects, and prompts;
- repository authentication, workspace initialization, and provider tools.

The workspace layer owns persistent coding state and compute lifecycle. Pi
Durable owns conversation history, request deduplication, and agent execution.

## Files

- `definition.ts` defines and parses the workflow DSL.
- `store.ts` defines registration and session records plus the persistence contract.
- `sqlite-store.ts` atomically persists repository snapshots and session identity.
- `runtime.ts` matches events, opens conversations, admits deduplicated input, and
  releases idle compute.
- `index.ts` exports the public workflow API.

GitHub discovery is in `integrations/github/registration.ts`; GitHub event
translation and activation are in `integrations/github/handler.ts`.

## Registration

Only complete, validated snapshots are passed to `replaceSnapshot()`. Replacing
a snapshot removes definitions deleted at the new revision, while a discovery
or parse failure leaves the previous snapshot intact. Integrations must source
snapshots from a trusted branch and reject unsupported event names before
persistence.

A session stores the definition and revision that created it. Updating a
repository registration therefore changes new sessions without silently
changing the instructions or model of an existing long-lived conversation.

## Dispatch

`WorkflowRuntime.dispatch()` accepts the normalized integration event contract.
It matches workflows by integration, scope, and event name; deduplicates by the
integration, instance, and delivery ID; and routes sessions by integration,
instance, scope, and subject. See `../contracts/integration.ts` for the validated
event shape.

Every matching registration is attempted independently. Failures are aggregated
only after all matches have been attempted. Admission for the same session is
serialized within the process so concurrent webhook requests cannot create two
conversations locally. Pi Durable deduplicates retries by request ID.

The integration activation callback prepares provider-specific workspace state
and returns the session-scoped extension. Once the submission settles and the
conversation is idle, the runtime suspends compute while preserving storage.

## Current limitations

- Conversation assignment is coordinated in SQLite but conversation creation is
  not atomic with Pi Durable storage; multi-process dispatch needs a durable
  claim/lease before horizontal scaling.
- Extensions are session-scoped and reinstalled when an event activates a
  session. Restoring provider tools before in-flight task recovery will require
  a startup extension loader.
- Trigger filters, permissions, schedules, and environment realization are not
  implemented and remain intentionally absent from the DSL.
