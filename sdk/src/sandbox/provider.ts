import type { Sandbox } from "./sandbox.ts";

/** Native infrastructure operations. Factory owns lifecycle policy and per-key coordination. */
export interface SandboxProvider {
  /** Create or reuse compute and persistent storage. Reopen after suspend or destroy. */
  open(key: string): Promise<Sandbox>;
  /** Stop compute while preserving persistent files. Safe when already suspended. */
  suspend(key: string): Promise<void>;
  /** Remove compute and owned storage. Safe when the key is already absent. */
  destroy(key: string): Promise<void>;
}
