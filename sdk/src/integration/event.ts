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
