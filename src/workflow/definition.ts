import * as z from "zod";

const workflowDefinition = z.strictObject({
  name: z.string(),
  on: z.record(z.string(), z.null()),
  permissions: z.record(z.string(), z.record(z.string(), z.literal(["read", "write"]))),
  sandbox: z.strictObject({
    provider: z.string(),
    environment: z.string(),
    resources: z
      .strictObject({
        cpu: z.number().int().positive().default(1),
        memory: z.number().int().positive().default(2),
        volume: z.number().int().positive().default(4),
      })
      .default({ cpu: 1, memory: 2, volume: 4 }),
  }),
  agent: z.strictObject({
    provider: z.string(),
    model: z.string(),
    instructions: z.string(),
  }),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinition>;

export function parseWorkflowDefinition(workflow: string): WorkflowDefinition {
  return workflowDefinition.parse(Bun.YAML.parse(workflow));
}
