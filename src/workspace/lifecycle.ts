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

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1_000;
const DEFAULT_RETENTION = 7 * 24 * 60 * 60 * 1_000;

export type WorkspaceInitializer = (env: ExecutionEnv, context: Context) => Promise<void>;

export interface WorkspaceLifecycleOptions {
  provider: SandboxProvider;
  store: WorkspaceStore;
  idleTimeoutMs?: number;
  retentionMs?: number;
  now?: () => Date;
}

/** Coordinates persistent workspace state with ephemeral sandbox compute. */
export class WorkspaceLifecycle {
  readonly #provider: SandboxProvider;
  readonly #store: WorkspaceStore;
  readonly #idleTimeoutMs: number;
  readonly #retentionMs: number;
  readonly #now: () => Date;

  constructor(options: WorkspaceLifecycleOptions) {
    this.#provider = options.provider;
    this.#store = options.store;
    this.#idleTimeoutMs = duration(options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT, "idle timeout");
    this.#retentionMs = duration(options.retentionMs ?? DEFAULT_RETENTION, "retention");
    this.#now = options.now ?? (() => new Date());
  }

  /** Creates fresh resources, initializes them once, and marks the workspace active. */
  async create(id: string, initialize: WorkspaceInitializer, context: Context): Promise<ExecutionEnv> {
    validateId(id);
    const createdAt = this.#time();
    const record: WorkspaceRecord = {
      id,
      state: "initializing",
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
      const active = this.#active(record, this.#time());
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
      const active = this.#active(claimed, this.#time());
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

    const active = this.#active(record, this.#time());
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

    const claimed = record.state === "suspending" ? record : await this.#transition(record, "suspending", context);
    await this.#provider.suspend(id, context);

    const suspended: WorkspaceRecord = {
      ...claimed,
      state: "suspended",
      version: claimed.version + 1,
    };
    if (!(await this.#store.replace(suspended, claimed.version, context))) {
      const current = await this.#store.get(id, context);
      if (current?.state !== "suspended") throw new Error(`Workspace changed while suspending: ${id}`);
    }
  }

  /** Permanently removes compute, storage, and the lifecycle record. */
  async destroy(id: string, context: Context): Promise<void> {
    validateId(id);
    const record = await this.#store.get(id, context);
    if (!record) {
      await this.#provider.destroy(id, context);
      return;
    }

    const claimed = record.state === "destroying" ? record : await this.#transition(record, "destroying", context);
    await this.#provider.destroy(id, context);
    if (!(await this.#store.delete(id, claimed.version, context)) && (await this.#store.get(id, context))) {
      throw new Error(`Workspace changed while destroying: ${id}`);
    }
  }

  async #required(id: string, context: Context): Promise<WorkspaceRecord> {
    const record = await this.#store.get(id, context);
    if (!record) throw new Error(`Workspace does not exist: ${id}`);
    return record;
  }

  /** Claims a provider operation with an atomic version change. */
  async #transition(record: WorkspaceRecord, state: WorkspaceState, context: Context): Promise<WorkspaceRecord> {
    const next = { ...record, state, version: record.version + 1 };
    if (!(await this.#store.replace(next, record.version, context))) {
      throw new Error(`Workspace changed concurrently: ${record.id}`);
    }
    return next;
  }

  #active(record: WorkspaceRecord, now: Date): WorkspaceRecord {
    return {
      ...record,
      state: "active",
      initializedAt: record.initializedAt ?? now,
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
