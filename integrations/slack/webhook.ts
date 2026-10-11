import { createHmac, timingSafeEqual } from "node:crypto";
import type { IntegrationContext, WebhookHandler } from "factory-oss/integration";

type SlackEnvelope = {
  type?: unknown;
  challenge?: unknown;
  team_id?: unknown;
  event_id?: unknown;
  event?: unknown;
};

export type SlackWebhookOptions = {
  signingSecret: string;
  teamId: string;
};

/** Verify and decode Slack Events API deliveries. */
export function createSlackWebhookHandler(options: SlackWebhookOptions, ctx: IntegrationContext): WebhookHandler {
  if (!options.signingSecret.trim()) throw new Error("Slack signing secret must not be empty.");
  if (!options.teamId.trim()) throw new Error("Slack team ID must not be empty.");

  return async (request) => {
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
      return new Response("Invalid Slack signature", { status: 401 });
    }
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return new Response("Invalid Slack signature", { status: 401 });
    }

    const body = await request.text();
    const expected = `v0=${createHmac("sha256", options.signingSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
    const expectedBytes = Buffer.from(expected);
    const signatureBytes = Buffer.from(signature);
    if (expectedBytes.length !== signatureBytes.length || !timingSafeEqual(expectedBytes, signatureBytes)) {
      return new Response("Invalid Slack signature", { status: 401 });
    }

    let payload: SlackEnvelope;
    try {
      const value: unknown = JSON.parse(body);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      payload = value as SlackEnvelope;
    } catch {
      return new Response("Invalid Slack payload", { status: 400 });
    }

    if (payload.type === "url_verification") {
      if (typeof payload.challenge !== "string") {
        return new Response("Invalid Slack challenge", { status: 400 });
      }
      return new Response(payload.challenge, { headers: { "content-type": "text/plain" } });
    }

    if (
      payload.type !== "event_callback" ||
      typeof payload.team_id !== "string" ||
      typeof payload.event_id !== "string" ||
      !payload.event ||
      typeof payload.event !== "object" ||
      Array.isArray(payload.event)
    ) {
      return new Response("Invalid Slack payload", { status: 400 });
    }
    if (payload.team_id !== options.teamId) return new Response(null, { status: 204 });

    const event = payload.event as Record<string, unknown>;
    let name: string;
    if (event.type === "app_mention") {
      if (
        typeof event.user !== "string" ||
        typeof event.text !== "string" ||
        typeof event.channel !== "string" ||
        typeof event.ts !== "string"
      ) {
        return new Response("Invalid Slack event", { status: 400 });
      }
      name = "app_mention";
    } else if (event.type === "message" && (event.channel_type === "channel" || event.channel_type === "group")) {
      if (
        typeof event.channel !== "string" ||
        typeof event.ts !== "string" ||
        (event.thread_ts !== undefined && typeof event.thread_ts !== "string")
      ) {
        return new Response("Invalid Slack event", { status: 400 });
      }
      name = event.channel_type === "channel" ? "message.channels" : "message.groups";
    } else {
      return new Response(null, { status: 204 });
    }

    const accepted = await ctx.events.receive({ id: payload.event_id, name, payload });
    return new Response(null, { status: accepted ? 200 : 204 });
  };
}
