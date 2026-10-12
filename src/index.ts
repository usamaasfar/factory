import sources from "../.factory/integrations.ts";
import { api } from "./api.ts";
import { registerIntegrations } from "./integration.ts";
import { workflowTrigger } from "./workflow/trigger.ts";

const port = Number(Bun.env.PORT ?? 8080);

// Set up configured integrations before accepting requests. The base URL supplies
// their webhook addresses; the callback runs for each verified, resolved event.
await registerIntegrations(sources, `http://localhost:${port}`, async (event) => {
  await workflowTrigger(event);
});

export default {
  hostname: "127.0.0.1",
  port,
  fetch: api.fetch,
};
