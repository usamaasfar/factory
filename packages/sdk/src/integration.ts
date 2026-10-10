import type { TSchema } from "@earendil-works/pi-ai";
import {
  defineTool as defineRuntimeTool,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";

export type { Static, TSchema } from "@earendil-works/pi-ai";
export { Type } from "@earendil-works/pi-ai";
export type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration as IntegrationTool,
} from "@earendil-works/pi-durable";
export interface ToolResult {
  /** Short, factual feedback shown to the agent after the tool call. */
  readonly content: string;
}

/** Adapt the integration's plain text result to Pi Durable's message format. */
export function defineTool<Schema extends TSchema>(
  definition: Omit<ToolRegistration<Schema>, "execute"> & {
    execute(
      ...args: Parameters<ToolRegistration<Schema>["execute"]>
    ): ToolResult | ToolExecutionResult | Promise<ToolResult | ToolExecutionResult>;
  },
): ToolRegistration<Schema> {
  return defineRuntimeTool({
    ...definition,
    async execute(...args) {
      const result = await definition.execute(...args);
      if (typeof result.content === "string") {
        return { content: [{ type: "text", text: result.content }] };
      }
      return result as ToolExecutionResult;
    },
  });
}

/** Experimental event result. Delivery metadata stays outside the result. */
export interface EventResult {
  /** Integration-defined resource path, including parent and comment identity. */
  readonly subject: string;
  /** Short, factual agent-facing description, not instructions. */
  readonly content: string;
}

/** Verified provider delivery, before an event definition interprets it. */
export interface EventDelivery {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
}

/** Executable event definition registered by name in Factory. */
export interface EventDefinition {
  readonly name: string;
  readonly description: string;
  execute(delivery: EventDelivery): EventResult | undefined | Promise<EventResult | undefined>;
}

/** Define how a verified provider delivery becomes agent-facing context. */
export function defineEvent<Payload = unknown>(definition: {
  name: string;
  description: string;
  parameters?: { parse(value: unknown): Payload };
  execute(delivery: { id: string; payload: Payload }): EventResult | undefined | Promise<EventResult | undefined>;
}): EventDefinition {
  return {
    name: definition.name,
    description: definition.description,
    execute(delivery) {
      const payload = definition.parameters
        ? definition.parameters.parse(delivery.payload)
        : (delivery.payload as Payload);
      return definition.execute({ id: delivery.id, payload });
    },
  };
}

export type WebhookHandler = (request: Request) => Response | Promise<Response>;

/** Factory-owned setup capabilities, separate from tool invocation context. */
export interface IntegrationContext {
  readonly webhook: {
    /** Register once during startup; return the configured public endpoint URL. */
    register(handler: WebhookHandler): string;
  };
  readonly events: {
    /** Look up and execute a registered event; false means unsupported. */
    receive(delivery: EventDelivery): Promise<boolean>;
  };
}

/** Builds tools from shared provider resources and Factory's setup context. */
export type ToolFactory<Client> = (client: Client, ctx: IntegrationContext) => readonly ToolRegistration[];

/** Resources created together for one configured integration scope. */
export interface Integration {
  readonly tools: readonly ToolRegistration[];
  readonly events?: readonly EventDefinition[];
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
