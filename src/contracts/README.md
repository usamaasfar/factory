# Factory contracts

This directory contains the shared contracts between Factory components.
Components depend on these contracts instead of another component's concrete
implementation. `src/index.ts` selects implementations and connects them.

These contracts are internal and evolving. They will be revised as Factory uses
them across real integrations, workflows, workspaces, and sandbox providers.

## Rules

1. Contracts define only values and behavior that cross a Factory component boundary.
2. Contracts must not import concrete implementations.
3. Provider-specific types remain inside their integration or provider.
4. Runtime schemas validate values where they enter a component boundary.
5. Trusted internal operations do not need redundant validation.
6. Behavioral guarantees that types cannot express are documented and tested.
7. Keep contracts small; add fields and capabilities only when an implementation needs them.

## Integration event

`integration.ts` defines the normalized event passed from an integration into
Factory workflow matching and admission. Provider-native events remain private
to their integrations.

An event contains:

- `integration`: stable integration kind, such as `github` or `slack`;
- `instance`: configured installation, account, or connection identity;
- `id`: delivery identity unique within that instance;
- `name`: integration-defined event name;
- `scope`: integration-defined workflow matching boundary;
- `subject`: stable identity used for durable workflow session routing;
- `content`: factual agent-facing description of the event.

Factory treats the individual identity values as opaque. Deduplication uses
`(integration, instance, id)`. Durable session routing uses
`(integration, instance, scope, subject)`.

An event is independent of its delivery mechanism. Webhooks, pollers, queue
consumers, streams, and schedulers may all emit events. A workflow trigger is a
rule that matches an event.

## Integration direction

Factory will derive integration contracts from concrete implementations rather
than predict every provider:

1. Complete the event contract and apply it to GitHub.
2. Extract setup, activation, tool, and workspace-preparation contracts only as
   the GitHub implementation reaches those boundaries.
3. Add Slack as a contrasting non-repository integration and revise assumptions
   exposed by it.
4. Continue validating contracts against materially different integrations
   before treating them as stable.

Factory owns workflow, session, workspace, and sandbox lifecycle. Integrations
may contribute behavior at explicit stages, such as session activation or
workspace preparation, without owning those lifecycles. Provider credentials
remain inside the integration.

## Event implementation notes

The first event slice is applied to GitHub and the workflow runtime:

- GitHub keeps its webhook payload types private and emits `IntegrationEvent`.
- The workflow runtime validates the event before matching or admission.
- Workflow trigger names are formed as `<integration>.<name>`.
- Matching currently maps `integration` and `scope` onto the workflow store's
  transitional provider and repository fields.
- Deduplication and session-routing tuples are encoded as JSON when passed into
  existing scalar persistence and Pi Durable request-ID boundaries.
- A GitHub workflow event without an installation identity is rejected before
  dispatch because it cannot identify an integration instance.

The workflow store still uses repository-oriented internal names. This event
slice does not rename or generalize that persistence contract.
