import type { IntegrationTool } from "./tool.ts";

/**
 * A named permission boundary. Tool ownership follows containment; child
 * resources have their own boundaries, not implicit grants from their parent.
 */
export interface Resource {
  readonly name: string;
  readonly tools?: readonly IntegrationTool[];
  readonly resources?: readonly Resource[];
}

/** Types a resource without initializing clients, selecting tools, or granting access. */
export function defineResource<const Definition extends Resource>(definition: Definition): Definition {
  return definition;
}
