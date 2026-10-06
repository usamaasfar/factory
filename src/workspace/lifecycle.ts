/**
 * Workspace lifecycle policy.
 *
 * A workspace has persistent storage and disposable compute. Creation runs its
 * initializer exactly once; suspension releases compute; reopening attaches the
 * same storage; destruction removes both. State is claimed in the store before
 * provider operations so concurrent callers cannot silently overwrite it.
 */

import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { SandboxProvider } from "../sandbox/provider.ts";
import type { WorkspaceRecord, WorkspaceState, WorkspaceStore } from "./store.ts";

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1_000; // 5 minutes
const DEFAULT_OPERATION_TIMEOUT = 30 * 60 * 1_000; // 30 minutes
const DEFAULT_RETENTION = 7 * 24 * 60 * 60 * 1_000; // 7 days
const SWEEP_LIMIT = 100; // maximum number of records to sweep

export type WorkspaceInitializer = (env: ExecutionEnv, context: Context) => Promise<void>;

export interface WorkspaceLifecycleOptions {
  provider: SandboxProvider;
  store: WorkspaceStore;
  idleTimeoutMs?: number;
  operationTimeoutMs?: number;
  retentionMs?: number;
  now?: () => Date;
}

/** Coordinates persistent workspace state with ephemeral sandbox compute. */
export class WorkspaceLifecycle {
  readonly #provider: SandboxProvider;
  readonly #store: WorkspaceStore;
  readonly #idleTimeoutMs: number;
  readonly #operationTimeoutMs: number;
  readonly #retentionMs: number;
  readonly #now: () => Date;

  constructor(options: WorkspaceLifecycleOptions) {
    this.#provider = options.provider;
    this.#store = options.store;
    this.#idleTimeoutMs = duration(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT, "idle timeout");
    this.#operationTimeoutMs = duration(options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT, "operation timeout");
    this.#retentionMs = duration(options.retentionMs ?? DEFAULT_RETENTION, "retention");
    this.#now = options.now ?? (() => new Date());
  }

  /** Ensures a workspace has completed initialization without rerunning its initializer. */
  async ensure(id: string, initialize: WorkspaceInitializer, context: Context): Promise<void> {
    validateId(id);
    const existing = await this.#store.get(id, context);
    if (existing) {
      if (existing.state === "active" || existing.state === "suspended") return;
      throw unavailable(existing);
    }

    try {
      await this.create(id, initialize, context);
    } catch (error) {
      // Cancellation must remain observable even if another caller completes
      // initialization while this operation is unwinding.
      if (context.abortSignal?.aborted) throw error;

      // Another caller may have won the create claim and completed before we
      // observed the conflict. Transitional state remains unavailable so its
      // caller can retry after the in-flight initialization settles.
      const raced = await this.#store.get(id, context);
      if (raced?.state === "active" || raced?.state === "suspended") return;
      throw error;
    }
  }

  /** Creates fresh resources, initializes them once, and marks the workspace active. */
  async create(id: string, initialize: WorkspaceInitializer, context: Context): Promise<ExecutionEnv> {
    validateId(id);
    const createdAt = this.#time();
    const record: WorkspaceRecord = {
      id,
      state: "initializing",
      stateChangedAt: createdAt,
      createdAt,
      lastActiveAt: createdAt,
      suspendAt: after(createdAt, this.#idleTimeoutMs),
      expiresAt: after(createdAt, this.#retentionMs),
      version: 0,
    };
    if (!(await this.#store.create(record, context))) throw new Error(`Workspace already exists: ${id}`);

    try {
      const env = await this.#provider.open(id, context);
      await initialize(env, context);
      const active = this.#activate(record, this.#time());
      if (!(await this.#store.replace(active, record.version, context))) {
        throw new Error(`Workspace changed during initialization: ${id}`);
      }
      return env;
    } catch (error) {
      await this.#discardFailedCreation(record, context, error);
      throw error;
    }
  }

  /** Opens initialized storage on compute and refreshes its activity deadlines. */
  async open(id: string, context: Context): Promise<ExecutionEnv> {
    validateId(id);
    const record = await this.#required(id, context);
    if (record.state !== "active" && record.state !== "suspended") throw unavailable(record);
    const claimed = await this.#transition(record, "resuming", context);

    try {
      const env = await this.#provider.open(id, context);
      const active = this.#activate(claimed, this.#time());
      if (!(await this.#store.replace(active, claimed.version, context))) {
        throw new Error(`Workspace changed while resuming: ${id}`);
      }
      return env;
    } catch (error) {
      await this.#recoverOpen(claimed, context, error);
      throw error;
    }
  }

  /** Records active work, extending both the compute idle and storage retention deadlines. */
  async touch(id: string, context: Context): Promise<void> {
    validateId(id);
    const record = await this.#required(id, context);
    if (record.state !== "active") throw unavailable(record);

    const active = this.#refresh(record, this.#time());
    if (!(await this.#store.replace(active, record.version, context))) {
      throw new Error(`Workspace changed while recording activity: ${id}`);
    }
  }

  /** Releases compute without changing the persistent storage deadline. */
  async suspend(id: string, context: Context): Promise<void> {
    validateId(id);
    const record = await this.#store.get(id, context);
    if (!record || record.state === "suspended") return;
    if (record.state !== "active" && record.state !== "suspending") throw unavailable(record);
    if (!(await this.#suspend(record, false, context))) throw new Error(`Workspace changed while suspending: ${id}`);
  }

  /** Permanently removes compute, storage, and the lifecycle record. */
  async destroy(id: string, context: Context): Promise<void> {
    validateId(id);
    const record = await this.#store.get(id, context);
    if (!record) {
      await this.#provider.destroy(id, context);
      return;
    }
    if (!(await this.#destroy(record, context))) throw new Error(`Workspace changed while destroying: ${id}`);
  }

  /** Suspends idle compute, destroys expired storage, and recovers abandoned transitions. */
  async sweep(context: Context): Promise<void> {
    const now = this.#time();
    const staleBefore = after(now, -this.#operationTimeoutMs);
    const records = await this.#store.findDue(now, staleBefore, SWEEP_LIMIT, context);
    const errors: unknown[] = [];

    for (const record of records) {
      try {
        if (record.expiresAt <= now || record.state === "initializing" || record.state === "destroying") {
          await this.#destroy(record, context);
        } else if (record.state === "active" || record.state === "suspending" || record.state === "resuming") {
          await this.#suspend(record, true, context);
        }
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) throw new AggregateError(errors, "Workspace sweep failed");
  }

  async #required(id: string, context: Context): Promise<WorkspaceRecord> {
    const record = await this.#store.get(id, context);
    if (!record) throw new Error(`Workspace does not exist: ${id}`);
    return record;
  }

  /** Claims a provider operation with an atomic version change. */
  async #transition(record: WorkspaceRecord, state: WorkspaceState, context: Context): Promise<WorkspaceRecord> {
    const next = await this.#tryTransition(record, state, context);
    if (!next) throw new Error(`Workspace changed concurrently: ${record.id}`);
    return next;
  }

  async #tryTransition(
    record: WorkspaceRecord,
    state: WorkspaceState,
    context: Context,
  ): Promise<WorkspaceRecord | undefined> {
    const next = { ...record, state, stateChangedAt: this.#time(), version: record.version + 1 };
    return (await this.#store.replace(next, record.version, context)) ? next : undefined;
  }

  async #suspend(record: WorkspaceRecord, recoverResuming: boolean, context: Context): Promise<boolean> {
    if (record.state === "suspended") return true;
    if (record.state === "resuming" && !recoverResuming) return false;
    if (record.state !== "active" && record.state !== "resuming" && record.state !== "suspending") return false;

    const claimed = record.state === "suspending" ? record : await this.#tryTransition(record, "suspending", context);
    if (!claimed) return false;

    await this.#provider.suspend(record.id, context);
    const suspended: WorkspaceRecord = {
      ...claimed,
      state: "suspended",
      stateChangedAt: this.#time(),
      version: claimed.version + 1,
    };
    if (await this.#store.replace(suspended, claimed.version, context)) return true;
    return (await this.#store.get(record.id, context))?.state === "suspended";
  }

  async #destroy(record: WorkspaceRecord, context: Context): Promise<boolean> {
    const claimed = record.state === "destroying" ? record : await this.#tryTransition(record, "destroying", context);
    if (!claimed) return false;

    await this.#provider.destroy(record.id, context);
    if (await this.#store.delete(record.id, claimed.version, context)) return true;
    return (await this.#store.get(record.id, context)) === undefined;
  }

  #activate(record: WorkspaceRecord, now: Date): WorkspaceRecord {
    return {
      ...this.#refresh(record, now),
      state: "active",
      stateChangedAt: now,
      initializedAt: record.initializedAt ?? now,
    };
  }

  #refresh(record: WorkspaceRecord, now: Date): WorkspaceRecord {
    return {
      ...record,
      lastActiveAt: now,
      suspendAt: after(now, this.#idleTimeoutMs),
      expiresAt: after(now, this.#retentionMs),
      version: record.version + 1,
    };
  }

  async #discardFailedCreation(record: WorkspaceRecord, context: Context, cause: unknown): Promise<void> {
    // Cleanup must finish even when cancellation caused initialization to fail.
    const cleanupContext = withoutAbortSignal(context);
    try {
      await this.#provider.destroy(record.id, cleanupContext);
      if (!(await this.#store.delete(record.id, record.version, cleanupContext))) {
        throw new Error(`Workspace changed while cleaning up: ${record.id}`);
      }
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], `Could not clean up workspace ${record.id}`);
    }
  }

  async #recoverOpen(record: WorkspaceRecord, context: Context, cause: unknown): Promise<void> {
    // Return uncertain compute to a known suspended state before exposing failure.
    const cleanupContext = withoutAbortSignal(context);
    try {
      await this.#provider.suspend(record.id, cleanupContext);
      const suspended: WorkspaceRecord = {
        ...record,
        state: "suspended",
        stateChangedAt: this.#time(),
        version: record.version + 1,
      };
      await this.#store.replace(suspended, record.version, cleanupContext);
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], `Could not recover workspace ${record.id}`);
    }
  }

  #time(): Date {
    const now = this.#now();
    if (!Number.isFinite(now.getTime())) throw new Error("Workspace clock returned an invalid date");
    return new Date(now);
  }
}

function validateId(id: string): void {
  if (!id) throw new TypeError("Workspace id is required");
}

function duration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Workspace ${name} must be a positive integer`);
  return value;
}

function after(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function unavailable(record: WorkspaceRecord): Error {
  return new Error(`Workspace ${record.id} is ${record.state}`);
}
