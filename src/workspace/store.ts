/** Persistent state used to coordinate workspace storage and sandbox compute. */

import type { Context } from "@earendil-works/chord";

/** Transitional states claim infrastructure work before it begins. */
export type WorkspaceState = "initializing" | "active" | "resuming" | "suspending" | "suspended" | "destroying";

/** Durable lifecycle metadata for one workflow workspace. */
export interface WorkspaceRecord {
  readonly id: string;
  readonly state: WorkspaceState;
  readonly createdAt: Date;
  readonly initializedAt?: Date;
  readonly lastActiveAt: Date;
  readonly suspendAt: Date;
  readonly expiresAt: Date;
  readonly version: number;
}

/** Persistent, atomic storage for workspace lifecycle state. */
export interface WorkspaceStore {
  /** Inserts `record`, returning false when its id already exists. */
  create(record: WorkspaceRecord, context: Context): Promise<boolean>;
  get(id: string, context: Context): Promise<WorkspaceRecord | undefined>;
  /** Replaces a record only when its current version equals `expectedVersion`. */
  replace(record: WorkspaceRecord, expectedVersion: number, context: Context): Promise<boolean>;
  /** Removes a record only when its current version equals `expectedVersion`. */
  delete(id: string, expectedVersion: number, context: Context): Promise<boolean>;
}
