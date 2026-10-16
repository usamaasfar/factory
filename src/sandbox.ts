import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { defineDoc, type EnvTarget } from "@earendil-works/pi-durable";
import type { ExecutionEnv, Sandbox } from "factory-oss/sandbox";
import { createLocalDockerSandboxProvider } from "../sandboxes/local-docker/index.ts";
import type { WorkflowDefinition } from "./workflow/definition.ts";

type SandboxAssignment = { key: string; image: string };

/** An absent assignment means no filesystem or shell environment, never host access. */
export const SandboxDoc = defineDoc<{ sandbox: SandboxAssignment | null }>({
  kind: "factory.sandbox",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ sandbox: null }),
});

const sandboxes = new Map<string, Promise<Sandbox>>();

/** Capture configuration without provisioning infrastructure inside a Durable commit. */
export function createSandboxAssignment(config: NonNullable<WorkflowDefinition["sandbox"]>): SandboxAssignment {
  if (config.provider !== "local") throw new Error(`Unknown sandbox provider: ${config.provider}`);
  const image = Bun.env.FACTORY_SANDBOX_IMAGE?.trim();
  if (!image) throw new Error("Workflows with a sandbox require FACTORY_SANDBOX_IMAGE");
  return { key: randomUUID(), image };
}

/** Open on first use; concurrent environment requests share the same provider handle. */
export async function resolveSandboxEnv(
  { conversationId, cwd, read }: EnvTarget,
  context: Context,
): Promise<ExecutionEnv | undefined> {
  context.abortSignal?.throwIfAborted();
  const assignment = (await read.snapshot(SandboxDoc, conversationId, context))?.sandbox;
  if (!assignment) return undefined;

  let opening = sandboxes.get(assignment.key);
  if (!opening) {
    const provider = createLocalDockerSandboxProvider({
      image: assignment.image,
      socketPath: Bun.env.FACTORY_DOCKER_SOCKET?.trim() || undefined,
    });
    opening = provider.open(assignment.key).catch((error: unknown) => {
      // A failed open must not poison subsequent attempts.
      sandboxes.delete(assignment.key);
      throw error;
    });
    sandboxes.set(assignment.key, opening);
  }
  const sandbox = await opening;
  context.abortSignal?.throwIfAborted();
  return sandbox.toExecutionEnv(cwd);
}
