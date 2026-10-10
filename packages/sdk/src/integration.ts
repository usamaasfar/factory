import type { ToolRegistration } from "@earendil-works/pi-durable";

export type { Static, TSchema } from "@earendil-works/pi-ai";
export { Type } from "@earendil-works/pi-ai";
export type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration as IntegrationTool,
} from "@earendil-works/pi-durable";
export { defineTool } from "@earendil-works/pi-durable";

/**
 * Factory's setup and tool-construction context. Empty until concrete host
 * capabilities are needed; separate from the per-invocation execution context.
 */
export type IntegrationContext = Readonly<Record<string, never>>;

/** Builds tools from shared provider resources and Factory's setup context. */
export type ToolFactory<Client> = (client: Client, ctx: IntegrationContext) => readonly ToolRegistration[];

/** Resources created together for one configured integration scope. */
export interface Integration {
  readonly tools: readonly ToolRegistration[];
  /** Release integration-owned resources after tools are no longer in use. */
  readonly dispose?: () => void | Promise<void>;
}

/**
 * Types a resource factory without running or caching it. The owner calls it
 * once per configured scope and reuses the returned tools. Provider clients
 * live in the closure; separate calls and recovery create fresh resources.
 */
export function defineIntegration<Options, Result extends Integration | Promise<Integration>>(
  setup: (options: Options, ctx: IntegrationContext) => Result,
): (options: Options, ctx: IntegrationContext) => Result {
  return setup;
}
