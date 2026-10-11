import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

/** Manages compute and persistent storage for stable Factory sandbox keys. */
export interface SandboxProvider {
  /** Creates or resumes compute attached to the key's persistent storage. */
  open(key: string, context: Context): Promise<ExecutionEnv>;
  /** Releases compute while preserving persistent storage. */
  suspend(key: string, context: Context): Promise<void>;
  /** Permanently removes compute and persistent storage. */
  destroy(key: string, context: Context): Promise<void>;
}
