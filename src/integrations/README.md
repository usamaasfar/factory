# Integrations

Integrations connect external systems to Factory. GitHub is the first concrete
implementation and a source of requirements; it is not the protocol that every
future integration must imitate.

This document records the boundary we understand today and the questions that
must be answered before defining a public integration protocol. It deliberately
does not specify plugin interfaces yet.

## Goal

A Factory deployment should be able to add integrations such as GitHub, Slack,
Linear, Sentry, and Axiom without moving provider-specific concepts into the
workflow runtime.

An integration may need to:

- authenticate installations or accounts;
- receive, verify, and deduplicate external events;
- translate provider payloads into workflow events;
- identify the durable external subject an agent conversation follows;
- expose authenticated tools to an agent;
- prepare provider-specific workspace state;
- perform outbound actions;
- discover trusted workflow definitions when the provider stores source code.

Not every integration needs every capability. Slack does not need to clone a
repository to deliver a thread message, and Sentry does not need to own workflow
definitions to deliver an issue event.

## Boundary today

### Factory owns

- parsing and validating workflow definitions;
- storing trusted workflow snapshots;
- matching normalized events to definitions;
- durable workflow session and conversation identity;
- agent execution and request deduplication;
- workspace lifecycle and sandbox infrastructure;
- deciding which configured integrations are loaded.

### An integration owns

- provider SDKs and native payload types;
- request verification and provider delivery IDs;
- installation, tenant, and credential handling;
- provider event names and factual event descriptions;
- mapping native objects to durable subjects;
- authenticated tools and outbound provider operations;
- provider-specific workspace initialization;
- discovering definitions from a provider when applicable.

### Composition owns

The application entry point currently creates GitHub directly and the HTTP
server mounts a GitHub webhook route directly. This is acceptable for the first
integration, but it is not the intended public boundary. A future composition
layer should load configured integrations and mount their ingress without the
workflow runtime importing them.

## Current GitHub implementation

`github/registration.ts` discovers definitions from the trusted default branch
and submits a complete validated snapshot to `WorkflowStore`.

`github/webhooks.ts` verifies GitHub requests, narrows supported payloads, builds
factual prompts, and identifies pull-request subjects.

`github/handler.ts` translates supported events for `WorkflowRuntime` and
activates the GitHub-specific capabilities needed by a matched session.

`github/workspace.ts` resolves pull-request repository state and initializes a
coding workspace without putting credentials inside the sandbox.

`github/tools/` implements authenticated GitHub operations exposed to the
agent.

These are appropriate integration concerns. Their concrete function signatures
are internal and should not be treated as the eventual integration protocol.

## Representative flows

Studying different providers prevents the GitHub implementation from becoming
the accidental abstraction.

### GitHub pull request

1. Verify a webhook delivery.
2. Match its repository and event name to registered definitions.
3. Route all pull-request activity to the pull request's durable session.
4. Initialize a coding workspace from an immutable revision.
5. Expose repository-scoped API and Git transfer tools.
6. Submit the event using the delivery ID for deduplication.

GitHub also acts as a definition source by reading `.factory/workflows/` from a
trusted branch. That role is separate from event delivery and tools.

### Slack thread

1. Verify and acknowledge an Events API request within Slack's deadline.
2. Route a mention or message to a workspace/channel/thread subject.
3. Expose thread-scoped read and reply capabilities.
4. Usually run without repository initialization unless another configured
   capability supplies one.

Slack highlights asynchronous acknowledgement and subjects that are not
repositories.

### Linear issue

1. Verify an issue or comment webhook.
2. Route issue activity to an organization/team/issue subject.
3. Expose issue, comment, and project operations.
4. Optionally associate the issue with a repository supplied by another
   integration.

Linear highlights that the event source and coding workspace source may differ.

### Sentry issue

1. Verify an alert or issue event.
2. Route repeated occurrences to a stable project/issue subject.
3. Expose stack traces, releases, tags, and event samples.
4. Optionally correlate release metadata with a separately supplied repository.

Sentry highlights high-volume events, aggregation, and sensitive diagnostic
data.

### Axiom alert

1. Verify or authenticate an alert delivery.
2. Route an alert or investigation to a durable subject.
3. Expose bounded query capabilities with explicit dataset access.
4. Avoid placing broad query credentials in agent-controlled environments.

Axiom highlights capability scoping, data-volume limits, and credential
isolation.

## Protocol dimensions to resolve

A protocol design must make the following concerns explicit without requiring
all integrations to implement all of them.

### Packaging and isolation

"Bring your own integration" can mean either:

- trusted TypeScript code loaded into the Factory process; or
- an independently deployed service communicating with Factory over a network
  protocol.

The trust model, versioning, failure isolation, credential access, deployment,
and tool execution model differ substantially. This decision must be made
before public interfaces are designed.

### Installation and tenancy

We need to establish:

- what identifies an installation or account;
- how it is associated with a Factory tenant;
- where encrypted credentials live;
- how credential refresh and revocation work;
- whether one workflow may use capabilities from multiple installations.

### Event envelope

The runtime needs stable event identity, a namespaced event name, matching
scope, durable subject, and agent-facing content. The current event includes a
repository ID, which is too specific for a general protocol.

We must decide whether integrations provide only normalized text or also a
versioned structured payload. Structured data improves policy and filtering but
must remain serializable, bounded, and safe to persist.

### Scope and matching

A workflow may be scoped to a repository, Slack workspace, Linear team, Sentry
project, Axiom dataset, Factory tenant, or a combination. Scope must not be
modeled as a renamed repository ID.

Definition location is a separate concern. A GitHub repository can store a
workflow that listens to Linear or Sentry events, provided installation and
permission policy allows it.

### Subject routing

A subject identifies the external entity whose events belong to one durable
workflow session: a pull request, thread, issue, incident, or investigation.
Integrations must produce stable, provider-qualified subject identities. Cross-
provider correlation should be explicit rather than inferred from free-form
strings.

### Capabilities and tools

Some integrations only deliver events; others also expose tools. We need to
decide:

- how capabilities are named and selected by a workflow;
- how authorization is narrowed to the workflow and subject;
- how an in-flight conversation reacquires capabilities after restart;
- whether tools execute in Factory, an integration service, or the sandbox;
- how dangerous operations declare replay and approval behavior.

Pi extensions are the current internal mechanism, not necessarily the public
integration representation.

### Workspace contribution

Workspace initialization is optional and should not be part of the minimum
event protocol. A provider may contribute repository contents, diagnostic
artifacts, or no files at all. Multiple integrations may need to contribute to
one workflow without sharing credentials with the sandbox.

### Ingress and acknowledgement

Providers have different delivery and acknowledgement contracts. The protocol
must account for signature verification, retries, ordering, duplicates,
rate-limits, and providers that require an immediate acknowledgement before
workflow admission finishes.

## Security invariants

Regardless of protocol shape:

- unverified external input must never reach workflow dispatch;
- provider delivery IDs must be namespaced before deduplication;
- credentials remain outside agent-controlled workspaces and prompts;
- tools receive the narrowest installation and resource scope available;
- workflow definitions come from an explicitly trusted source;
- persisted provider payloads are bounded and treated as sensitive;
- an integration cannot silently grant capabilities absent from workflow and
  deployment policy.

## Deliberate non-decisions

The following should not be introduced until the protocol dimensions above are
resolved:

- a generic `Integration` interface;
- plugin registries or dynamic package loading;
- universal lifecycle hooks;
- a generic credential schema;
- a transport-independent RPC API;
- forced workspace support for every integration;
- converting every provider payload into GitHub-shaped repository events.

## Next design steps

1. Decide whether third-party integrations are in-process packages,
   out-of-process services, or two separately versioned mechanisms.
2. Write one end-to-end contract sketch for GitHub, Slack, Linear, and Sentry,
   including installation, ingress, routing, tools, restart, and revocation.
3. Identify the smallest common event and subject model from those sketches.
4. Separate optional protocols for definition discovery, capabilities, and
   workspace contribution instead of one large interface.
5. Review security and durability behavior before changing runtime or database
   contracts.
6. Use GitHub to implement and test the first accepted protocol version.

Until then, the integration code remains concrete by design and the workflow
APIs that still mention repositories should be considered internal and
transitional.
