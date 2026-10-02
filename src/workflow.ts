import { readFile } from "node:fs/promises";

export type Workflow = {
  name: string;
  triggers: string[];
  agent: {
    environment: string;
    provider: "deepseek";
    model: string;
    instructions: string;
  };
};

type UnknownRecord = Record<string, unknown>;

export async function loadWorkflow(path: string): Promise<Workflow> {
  const source = await readFile(path, "utf8");
  return parseWorkflow(Bun.YAML.parse(source));
}

export function parseWorkflow(value: unknown): Workflow {
  const root = record(value, "workflow");
  const triggers = record(root.on, "on");
  const agent = record(root.agent, "agent");
  const provider = string(agent.provider, "agent.provider");

  if (provider !== "deepseek") throw new Error(`Unsupported agent.provider: ${provider}`);

  const triggerNames = Object.keys(triggers);
  if (triggerNames.length === 0) throw new Error("Workflow must declare at least one trigger");
  for (const trigger of triggerNames) {
    if (triggers[trigger] !== null) throw new Error(`Trigger ${trigger} does not accept configuration yet`);
  }

  return {
    name: string(root.name, "name"),
    triggers: triggerNames,
    agent: {
      environment: string(agent.environment, "agent.environment"),
      provider,
      model: string(agent.model, "agent.model"),
      instructions: string(agent.instructions, "agent.instructions"),
    },
  };
}

function record(value: unknown, name: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}
