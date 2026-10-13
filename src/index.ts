import { api } from "./api.ts";
import { database, initializeDatabase } from "./database.ts";
import { registerIntegrations } from "./integration.ts";
import { workflow } from "./workflow/store.ts";
import { workflowTrigger } from "./workflow/trigger.ts";

const port = Number(Bun.env.PORT ?? 8080);

if (Bun.env.NODE_ENV === "development") {
  initializeDatabase(database);
  const paths = Array.from(new Bun.Glob("*.yml").scanSync({ cwd: "tests/workflows" })).sort();
  workflow.register(await Promise.all(paths.map((path) => Bun.file(`tests/workflows/${path}`).text())));
}

// Discover and initialize integrations before accepting requests. The base URL supplies
// their webhook addresses; the callback runs for each verified, resolved event.
await registerIntegrations(`http://localhost:${port}`, async (event) => {
  await workflowTrigger(event);
});

export default {
  hostname: "127.0.0.1",
  port,
  fetch: api.fetch,
};
