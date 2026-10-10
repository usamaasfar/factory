import { verify } from "@octokit/webhooks-methods";
import type { IntegrationContext, WebhookHandler } from "factory-oss/integration";
import * as z from "zod";

const envelopeSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number().int().positive() }).optional(),
  repository: z.object({ id: z.number().int().positive() }).optional(),
});

export type GitHubWebhookOptions = {
  secret: string;
  installationId: number;
  repositoryId: number;
};

/** Verify and decode deliveries; Factory owns event lookup and execution. */
export function createGitHubWebhookHandler(options: GitHubWebhookOptions, ctx: IntegrationContext): WebhookHandler {
  if (!options.secret.trim()) throw new Error("GitHub webhook secret must not be empty.");

  return async (request) => {
    const id = request.headers.get("x-github-delivery");
    const name = request.headers.get("x-github-event");
    const signature = request.headers.get("x-hub-signature-256");
    if (!id?.trim() || !name?.trim()) {
      return new Response("Missing GitHub delivery headers", { status: 400 });
    }
    if (!signature) return new Response("Invalid GitHub signature", { status: 401 });

    // Verify the original body before interpreting provider data.
    const body = await request.text();
    let verified = false;
    try {
      verified = await verify(options.secret, body, signature);
    } catch {
      // Malformed signatures are authentication failures.
    }
    if (!verified) return new Response("Invalid GitHub signature", { status: 401 });

    let payload: unknown;
    let envelope: z.infer<typeof envelopeSchema>;
    try {
      payload = JSON.parse(body);
      envelope = envelopeSchema.parse(payload);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return new Response("Invalid GitHub payload", { status: 400 });
      }
      throw error;
    }
    if (envelope.installation && envelope.installation.id !== options.installationId) {
      return new Response(null, { status: 204 });
    }
    if (envelope.repository && envelope.repository.id !== options.repositoryId) {
      return new Response(null, { status: 204 });
    }

    try {
      const accepted = await ctx.events.receive({
        id,
        name: envelope.action ? `${name}.${envelope.action}` : name,
        payload,
      });
      return new Response(null, { status: accepted ? 202 : 204 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return new Response("Invalid GitHub event payload", { status: 400 });
      }
      // Acceptance failures propagate as 5xx so GitHub can retry delivery.
      throw error;
    }
  };
}
