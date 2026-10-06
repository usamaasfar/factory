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
- `sqlite-store.ts` persists that contract through the application database.
- `initialize.ts` archives and installs a prepared coding repository.
- `publish.ts` exports clean commits as a credential-free Git bundle.
- `lifecycle.ts` implements workspace state transitions and maintenance.
- `lifecycle.test.ts` tests public behavior with a stateful fake provider,
  in-memory store, and deterministic clock.
- `initialize.test.ts` verifies transfer, identity, credential exclusion, and
  destination safety through Pi's local execution environment.
- `initialize.docker.test.ts` verifies initialization, suspension, resumption,
  and destruction across the real Docker boundary.
- `sqlite-store.test.ts` verifies the store against real in-memory SQLite.
- `database-schema.ts` contains the `workspaces` table with the other schemas.
- `index.ts` exports the public API.

## Lifecycle

`WorkspaceLifecycle` provides:

- `ensure()` — initializes a missing workspace, leaves an initialized workspace
  unchanged, and permits retry after failed initialization cleanup.
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

## Coding workspace initialization

`prepareCodingWorkspace()` accepts a clean repository root with a normal local
`.git` directory and `origin`. It records `HEAD`, symbolic-ref state, and all
remote output, then archives only `.git` and tracked files. Ignored files are
excluded because they commonly contain credentials, dependencies, and caches.
Repository-local credential helpers, HTTP authorization headers, and embedded
HTTP(S) credentials are rejected.

`initializeCodingWorkspace()` requires an empty destination, extracts the
archive without preserving host ownership, verifies Git state and remotes,
configures repository-local GitHub App identity, and confirms that the resulting
worktree is clean. It does not fetch, choose a branch, install dependencies, or
perform agent work.

Linked worktrees and submodules are currently rejected rather than risking an
incomplete transfer or recursively copying ignored submodule files.

`exportCodingWorkspaceChanges()` rejects uncommitted files, empty publications,
and histories that do not descend from the expected pull-request head. It
exports commit objects as a Git bundle; only the trusted host receives GitHub
credentials and pushes the validated fast-forward update.

The baseline image is defined by `docker/coding.Dockerfile` and built with:

```sh
bun run workspace:image
```

Docker initialization tests use `factory-coding:test`, or
`FACTORY_CODING_TEST_IMAGE` when set. The image contains only the Unix sandbox
contract plus Git, GNU tar, and CA certificates; language-specific tooling is a
later image-policy decision.

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
Startup sweeping is enabled; a later phase can also call it periodically with
`Bun.cron()`. Do not create one timer per workspace.

## Next phases

1. Add a thin periodic `Bun.cron()` trigger around `sweep()`; startup sweeping
   is already enabled.
2. Import updated pull-request revisions without discarding workspace changes.
3. Define language-specific tooling policy for production coding images.
