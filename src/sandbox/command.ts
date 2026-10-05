import type { Context } from "@earendil-works/chord";

/**
 * One command executed inside a Linux sandbox with Bash and GNU coreutils.
 * Factory uses this primitive to implement Pi's shell and filesystem APIs.
 */
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
 * Throws only when the command cannot be run or output handling fails.
 */
export type SandboxCommandRunner = (command: SandboxCommand, context: Context) => Promise<SandboxCommandResult>;
