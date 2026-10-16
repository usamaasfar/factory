import type { SandboxCommand, SandboxOutput, SandboxProcess } from "./command.ts";

/** Consume one native process, stopping it before an interrupted execution settles. */
export async function execute(
  start: (command: SandboxCommand) => Promise<SandboxProcess>,
  command: SandboxCommand,
  onOutput: (output: SandboxOutput) => void | Promise<void>,
): Promise<number> {
  command.signal.throwIfAborted();
  let process: SandboxProcess;
  try {
    process = await start(command);
  } catch (error) {
    if (command.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw command.signal.reason;
    }
    throw error;
  }
  let iterator: AsyncIterator<SandboxOutput> | undefined;
  let delivering = true;

  const output = (async () => {
    iterator = process.output[Symbol.asyncIterator]();
    while (true) {
      const chunk = await iterator.next();
      if (chunk.done) return;
      if (delivering) await onOutput(chunk.value);
    }
  })();
  const completed = Promise.all([process.exited, output]);
  const cancelled = Promise.withResolvers<never>();
  const abort = () => {
    delivering = false;
    cancelled.reject(command.signal.reason);
  };
  command.signal.addEventListener("abort", abort, { once: true });
  if (command.signal.aborted) abort();

  try {
    const [exitCode] = await Promise.race([completed, cancelled.promise]);
    command.signal.throwIfAborted();
    return exitCode;
  } catch (error) {
    delivering = false;
    try {
      await process.stop();
      await Promise.allSettled([process.exited, output]);
      // Explicit iteration lets us stop before returning an iterator whose cleanup
      // might itself wait for the remote process to terminate.
      await iterator?.return?.();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Could not cleanly stop sandbox execution");
    }
    throw error;
  } finally {
    command.signal.removeEventListener("abort", abort);
  }
}
