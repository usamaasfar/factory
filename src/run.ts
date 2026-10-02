import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { runAgent } from "./harness.ts";
import { DockerSandbox } from "./sandbox.ts";
import { loadWorkflow, type Workflow } from "./workflow.ts";

export type WorkflowEvent = {
  id: string;
  type: string;
  occurredAt: string;
  payload: unknown;
};

export type WorkflowRun = {
  id: string;
  workflow: string;
  eventId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  result?: string;
  error?: string;
};

type EnvironmentImages = Readonly<Record<string, string>>;

export async function executeWorkflow(options: {
  projectRoot: string;
  workflowPath: string;
  event: WorkflowEvent;
  environments: EnvironmentImages;
  database: string;
}): Promise<WorkflowRun> {
  const workflow = await loadWorkflow(options.workflowPath);
  if (!workflow.triggers.includes(options.event.type)) {
    throw new Error(`Workflow ${workflow.name} is not triggered by ${options.event.type}`);
  }

  const run: WorkflowRun = {
    id: crypto.randomUUID(),
    workflow: options.workflowPath,
    eventId: options.event.id,
    status: "pending",
  };
  const image = options.environments[workflow.agent.environment];
  if (!image) throw new Error(`Environment is not registered: ${workflow.agent.environment}`);

  const sandbox = await DockerSandbox.start(image);
  try {
    run.status = "running";
    await copyProject(options.projectRoot, sandbox);
    run.result = await executeAgent(workflow, options.event, run.id, options.database, sandbox);
    run.status = "succeeded";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : String(error);
  } finally {
    await sandbox.stop();
  }
  return run;
}

async function executeAgent(
  workflow: Workflow,
  event: WorkflowEvent,
  runId: string,
  database: string,
  sandbox: DockerSandbox,
): Promise<string> {
  return (
    await runAgent({
      sandbox,
      database,
      model: workflow.agent.model,
      instructions: workflow.agent.instructions,
      prompt: `Execute this workflow for a ${event.type} event. Work only in the provided workspace and verify the result.`,
      requestId: runId,
    })
  ).text;
}

async function copyProject(projectRoot: string, sandbox: DockerSandbox): Promise<void> {
  const entries = await readdir(projectRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const destination = relative(projectRoot, source).split(sep).join("/");
    await sandbox.writeBinary(destination, await readFile(source));
  }
}

if (import.meta.main) {
  const projectRoot = process.argv[2] ?? "tests";
  const workflowPath = join(projectRoot, ".factory/workflows/manual.yml");
  const run = await executeWorkflow({
    projectRoot,
    workflowPath,
    event: { id: crypto.randomUUID(), type: "manual", occurredAt: new Date().toISOString(), payload: {} },
    environments: { "test.linux": "factory-sandbox:test" },
    database: ".factory/state/runs.sqlite",
  });
  console.log(JSON.stringify(run, null, 2));
  if (run.status !== "succeeded") process.exitCode = 1;
}
