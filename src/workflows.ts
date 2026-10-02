import * as z from "zod";

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, "Must not be empty");
const eventName = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/, "Invalid event name");
const environmentName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Must be a name under .factory/environments");

// Empty YAML mappings and values mean an event has no filters.
const emptyTrigger = z.union([z.null(), z.strictObject({})]).transform(() => ({}));

export const workflowSchema = z.strictObject({
  name: nonEmptyString,
  on: z.record(eventName, emptyTrigger).refine((events) => Object.keys(events).length > 0, "Must contain an event"),
  agent: z.strictObject({
    environment: environmentName,
    resources: z.strictObject({
      cpu: z.number().int().positive(),
      memory: z.number().positive(),
    }),
    provider: nonEmptyString,
    model: nonEmptyString,
    instructions: nonEmptyString,
  }),
});

export type Workflow = z.infer<typeof workflowSchema>;

/** Parses and normalizes the strict initial Factory workflow DSL. */
export function parseWorkflow(source: string): Workflow {
  return workflowSchema.parse(Bun.YAML.parse(source));
}
