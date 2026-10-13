import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventDefinition, Integration, IntegrationContext, WebhookHandler } from "factory-oss/integration";

/** Agent-facing event with integration-namespaced delivery ID, name, and subject. */
export type ResolvedEvent = {
  id: string;
  name: string;
  subject: string;
  content: string;
};

/** Initialized capabilities; resources retain tool ownership and permission boundaries. */
export type LoadedIntegration = Omit<Integration, "events"> & {
  name: string;
  webhookUrl?: string;
  webhook?: WebhookHandler;
  events: Map<string, EventDefinition>;
};

const integrations = new Map<string, LoadedIntegration>();

/**
 * Discovers and initializes integrations before the server starts.
 * Uses each module’s directory name for its webhook URL and event namespace.
 * Resolved events go to onEvent; workflow execution stays outside this module.
 */
export async function registerIntegrations(
  baseUrl: string,
  onEvent: (event: ResolvedEvent) => void | Promise<void>,
): Promise<void> {
  const paths = Array.from(new Bun.Glob("*/index.ts").scanSync({ cwd: "integrations" })).sort();
  for (const entry of paths) {
    const path = resolve("integrations", entry);
    const name = basename(dirname(path));
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Invalid integration name: ${name}`);
    if (integrations.has(name)) throw new Error(`Duplicate integration: ${name}`);

    const module = await import(pathToFileURL(path).href);
    if (module.disabled === true) continue;

    const setup = module.default;
    if (typeof setup !== "function") throw new Error(`Integration ${name} must export a setup function`);

    const events = new Map<string, EventDefinition>();
    let webhook: WebhookHandler | undefined;
    let webhookUrl: string | undefined;

    const context: IntegrationContext = {
      webhook: {
        register(handler) {
          // The integration owns verification and parsing; the API forwards the raw request.
          if (webhook) throw new Error(`Webhook already registered for ${name}`);
          webhookUrl = new URL(`/webhook/${name}`, baseUrl).href;
          webhook = handler;
          return webhookUrl;
        },
      },
      events: {
        async receive(delivery) {
          // Webhook handlers submit verified deliveries using integration-relative event names.
          console.debug(`${name} webhook event: ${delivery.name} (${delivery.id})`);
          const event = events.get(delivery.name);
          if (!event) return false;

          const result = await event.execute(delivery);
          if (!result) return false;

          // Namespace once and await application acceptance before acknowledging the delivery.
          await onEvent({
            id: `${name}:${delivery.id}`,
            name: `${name}.${delivery.name}`,
            subject: `${name}:${result.subject}`,
            content: result.content,
          });
          return true;
        },
      },
    };

    const integration: (Integration & { name?: string }) | undefined = await setup(context);
    if (!integration) continue;
    if (integration.name !== undefined && integration.name !== name) {
      throw new Error(`Integration name ${integration.name} does not match ${name}`);
    }

    // Setup returns the definitions used by the webhook's receive callback.
    for (const event of integration.events ?? []) {
      if (events.has(event.name)) throw new Error(`Duplicate event: ${name}.${event.name}`);
      events.set(event.name, event);
    }

    integrations.set(name, { ...integration, name, webhookUrl, webhook, events });
    if (webhookUrl) console.log(`${name} webhook ready: ${webhookUrl}`);
  }
}

/** Looks up initialized capabilities without importing or setting up the module again. */
export function getIntegration(name: string): LoadedIntegration | undefined {
  return integrations.get(name);
}
