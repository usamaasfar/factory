import { isGitHubAppSender, parseGitHubWebhook, verifyGitHubWebhook } from "./integrations/github/webhook.ts";

export type ServerOptions = {
  webhookSecret: string;
  appLogin: string;
  port?: number;
  onGitHubEvent?: (event: NonNullable<ReturnType<typeof parseGitHubWebhook>>) => void | Promise<void>;
};

export function createServer(options: ServerOptions) {
  return Bun.serve({
    port: options.port ?? Number(process.env.PORT ?? 3000),
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      if (request.method !== "POST" || url.pathname !== "/webhooks/github") {
        return new Response("Not found", { status: 404 });
      }

      const body = new Uint8Array(await request.arrayBuffer());
      const valid = await verifyGitHubWebhook(body, request.headers.get("x-hub-signature-256"), options.webhookSecret);
      if (!valid) return new Response("Invalid signature", { status: 401 });

      try {
        const event = parseGitHubWebhook(request.headers, body);
        if (!event) return Response.json({ status: "ignored" });
        if (isGitHubAppSender(event, options.appLogin)) return Response.json({ status: "ignored" });

        await options.onGitHubEvent?.(event);
        return Response.json({ status: "accepted" }, { status: 202 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid webhook";
        return Response.json({ error: message }, { status: 400 });
      }
    },
  });
}

if (import.meta.main) {
  const webhookSecret = requiredEnvironmentVariable("GITHUB_WEBHOOK_SECRET");
  const appLogin = requiredEnvironmentVariable("GITHUB_APP_LOGIN");
  const server = createServer({
    webhookSecret,
    appLogin,
    onGitHubEvent: (event) => console.log(JSON.stringify(event)),
  });
  console.log(`Factory listening on ${server.url}`);
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
