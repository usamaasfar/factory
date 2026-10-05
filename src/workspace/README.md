# Workspace

A workspace is the persistent coding state for one workflow. Its storage can
outlive disposable sandbox compute so a workflow can pause while waiting for a
user or external event and later resume exactly where it stopped.

```text
create → initialize → active → suspend → suspended → open → active
                             └──────── retention expiry ────────→ destroy
```

Each workflow receives its own workspace. Initialization runs once for a new
workspace; resuming never reruns it.

## Boundaries

The workspace layer owns lifecycle policy:

- initialization state;
- activity and idle deadlines;
- storage retention;
- suspension, resumption, and expiration;
- recovery of abandoned lifecycle transitions.

The sandbox provider owns infrastructure mechanics:

- `open()` creates or resumes compute with persistent storage;
- `suspend()` releases compute while preserving storage;
- `destroy()` permanently removes compute and storage.

`Context` controls an individual operation. Expiration is persisted workspace
state and is not passed through `Context`.

Repository transfer, Git configuration, environment setup, Pi Durable wiring,
and agent execution are separate concerns.

## Files

- `store.ts` defines durable records and the atomic store contract.
- `lifecycle.ts` implements workspace state transitions and maintenance.
- `lifecycle.test.ts` tests public behavior with a stateful fake provider,
  in-memory store, and deterministic clock.
- `index.ts` exports the public API.

## Lifecycle

`WorkspaceLifecycle` provides:

- `create()` — claims a new ID, opens resources, runs an initializer once, and
  marks the workspace active. Failed initialization removes partial resources.
- `open()` — resumes initialized storage and refreshes activity deadlines.
- `touch()` — refreshes compute-idle and storage-retention deadlines.
- `suspend()` — releases compute without changing storage retention.
- `destroy()` — removes compute, storage, and lifecycle metadata.
- `sweep()` — suspends idle compute, destroys expired storage, and recovers
  abandoned transitions.

Default policy:

- compute idle timeout: 5 minutes;
- lifecycle operation timeout: 30 minutes;
- storage retention: 7 days;
- sweep batch size: 100 records.

The operation timeout is separate from idle timeout so a legitimate provider or
initialization operation is not considered abandoned after five minutes.

## Persistence

`WorkspaceStore` uses optimistic versions for atomic state transitions. A store
implementation must persist records across process restarts and implement
`findDue()` for:

- records whose `expiresAt` is due;
- active records whose `suspendAt` is due;
- transitional records whose `stateChangedAt` is stale.

The lifecycle claims state before calling a provider. Provider operations must
be idempotent because recovery may repeat them after a crash.

## Scheduling

`sweep()` contains the maintenance behavior and is independent of its trigger.
A later phase can call it at startup and periodically with `Bun.cron()`. Do not
create one timer per workspace.

## Next phases

1. Implement a persistent `WorkspaceStore` and workspace table independently of
   the existing application schema.
2. Add a thin startup/cron reaper around `sweep()`.
3. Implement coding-workspace initialization:
   - run trusted environment preparation;
   - transfer the prepared repository;
   - preserve Git state and remotes;
   - configure repository-local GitHub App identity;
   - verify the repository is clean and usable.
4. Integrate with Pi Durable only after workspace lifecycle and initialization
   are complete.
