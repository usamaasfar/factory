import type { Context } from "@earendil-works/chord";
import type { FactorySandbox } from "./factory-sandbox.ts";

/** Manages compute and persistent storage for stable sandboxes. */
export interface SandboxProvider {
  /** Opens the stable sandbox for `key`, creating or resuming its compute. */
  open(key: string, context: Context): Promise<FactorySandbox>;
  /** Idempotently releases compute while preserving persistent files. */
  suspend(key: string, context: Context): Promise<void>;
  /** Idempotently deletes compute and persistent files. */
  destroy(key: string, context: Context): Promise<void>;
}
