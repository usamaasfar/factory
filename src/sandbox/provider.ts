import type { Context } from "@earendil-works/chord";
import type { FactorySandbox } from "./factory-sandbox.ts";

/** Creates, reopens, and permanently destroys persistent sandboxes. */
export interface SandboxProvider {
  /** Opens the stable sandbox for `key`, creating it when absent. */
  open(key: string, context: Context): Promise<FactorySandbox>;
  /** Idempotently deletes the sandbox and its persistent files. */
  destroy(key: string, context: Context): Promise<void>;
}
