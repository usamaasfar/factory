import type { EventDefinition, IntegrationContext } from "./event.ts";
import type { Resource } from "./resource.ts";

/** Capabilities initialized together for one configured integration scope. */
export interface Integration {
  readonly resources: readonly Resource[];
  readonly events?: readonly EventDefinition[];
  /** Called by the owner after all uses of the integration have ended. */
  readonly dispose?: () => void | Promise<void>;
}

/** Types a setup factory without executing or caching it. */
export function defineIntegration<Result extends Integration | undefined | Promise<Integration | undefined>>(
  setup: (context: IntegrationContext) => Result,
): (context: IntegrationContext) => Result {
  return setup;
}
