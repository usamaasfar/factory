import { Hono } from "hono";
import { getIntegration } from "./integration.ts";

export const api = new Hono();

api.get("/health", (context) => context.json({ status: "ok" }));

api.post("/webhook/:integration", (context) => {
  const integration = getIntegration(context.req.param("integration"));
  if (!integration?.webhook) return context.notFound();

  return integration.webhook(context.req.raw);
});
