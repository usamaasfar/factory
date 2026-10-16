export interface SandboxOptions {
  /** Equal IDs identify the same files at the same absolute paths. */
  readonly id: string;
  /** Absolute Linux path; defaults to /workspace. */
  readonly cwd?: string;
}

export interface OperationOptions {
  readonly signal?: AbortSignal;
  /** Timeout in seconds. Cancellation waits for actual execution to stop. */
  readonly timeout?: number;
}

export interface ExecOptions extends OperationOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Inherit the sandbox's environment, never the Factory host's. Defaults to true. */
  readonly inheritEnv?: boolean;
  readonly stdin?: Uint8Array;
  readonly onOutput?: (text: string, stream: SandboxOutput["stream"]) => void | Promise<void>;
}

/** Normalized input passed to a provider. Execute as Bash source inside the sandbox. */
export interface SandboxCommand {
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly inheritEnv: boolean;
  /** Deliver EOF after this input, including when no input is provided. */
  readonly stdin?: Uint8Array;
  /** Also covers command startup. A rejected start must leave no running command. */
  readonly signal: AbortSignal;
}

export interface SandboxOutput {
  readonly stream: "stdout" | "stderr";
  readonly data: Uint8Array;
}

export interface SandboxProcess {
  /** Raw output, ordered within each stream. Ends after EOF, including after stop(). */
  readonly output: AsyncIterable<SandboxOutput>;
  /** Settles on process exit; rejects for transport failures, not nonzero exits. */
  readonly exited: Promise<number>;
  /**
   * Stop the command and its descendants without waiting for output consumption.
   * Must settle exited, close output, and be safe after exit or repeated calls.
   */
  stop(): Promise<void>;
}

export interface ExecResult {
  readonly exitCode: number;
}
