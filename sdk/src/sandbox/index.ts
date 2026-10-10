import type { Context } from "@earendil-works/chord";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

export type { ExecutionEnv } from "@earendil-works/pi-durable/env";
export { createCommandSandboxEnvironment } from "./environment.ts";

/** Manages compute and persistent storage for stable Factory sandbox keys. */
export interface SandboxProvider {
  /** Creates or resumes compute attached to the key's persistent storage. */
  open(key: string, context: Context): Promise<ExecutionEnv>;
  /** Releases compute while preserving persistent storage. */
  suspend(key: string, context: Context): Promise<void>;
  /** Permanently removes compute and persistent storage. */
  destroy(key: string, context: Context): Promise<void>;
}

/** One command executed by a command-backed sandbox environment. */
export interface SandboxCommand {
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly inheritEnv: boolean;
  readonly stdin?: Uint8Array;
  /** Called in arrival order. Runners must await the returned promise. */
  readonly onOutput?: (output: SandboxCommandOutput) => void | Promise<void>;
}

export interface SandboxCommandOutput {
  readonly stream: "stdout" | "stderr";
  readonly data: Uint8Array;
}

export interface SandboxCommandResult {
  /** A nonzero command exit is a result, not a transport failure. */
  readonly exitCode: number;
}

/**
 * Executes a command and stops it before rejecting when the context is aborted.
 * Throws only when transport or output handling fails.
 */
export type SandboxCommandRunner = (command: SandboxCommand, context: Context) => Promise<SandboxCommandResult>;

export interface CommandSandboxEnvironmentOptions {
  /** Stable file namespace identity shared by handles for the same storage. */
  readonly id: string;
  /** Absolute POSIX working directory. */
  readonly cwd: string;
  readonly run: SandboxCommandRunner;
}
