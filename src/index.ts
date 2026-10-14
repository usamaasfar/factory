import { api } from "./api.ts";
import { database, initializeDatabase } from "./database.ts";
import { registerIntegrations } from "./integration.ts";
import { workflow } from "./workflow/store.ts";
import { workflowTrigger } from "./workflow/trigger.ts";

const port = Number(Bun.env.PORT ?? 8080);
const hostname = Bun.env.HOST ?? "127.0.0.1";
const baseUrl = Bun.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const workflowsDirectory = Bun.env.WORKFLOWS_DIR ?? ".factory/workflows";

initializeDatabase(database);
const paths = Array.from(new Bun.Glob("*.{yml,yaml}").scanSync({ cwd: workflowsDirectory })).sort();
workflow.register(await Promise.all(paths.map((path) => Bun.file(`${workflowsDirectory}/${path}`).text())));
console.log(`Loaded ${paths.length} workflow(s) from ${workflowsDirectory}`);

// Discover and initialize integrations before accepting requests. The base URL supplies
// their webhook addresses; the callback runs for each verified, resolved event.
await registerIntegrations(baseUrl, async (event) => {
  await workflowTrigger(event);
});

export default {
  hostname,
  port,
  fetch: api.fetch,
};
