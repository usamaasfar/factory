import { createHmac, timingSafeEqual } from "node:crypto";
import type { EventDelivery, WebhookHandler } from "factory-oss/integration";
import { z } from "zod";

const envelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_verification"), challenge: z.string() }),
  z.looseObject({
    type: z.literal("event_callback"),
    team_id: z.string().min(1),
    event_id: z.string().min(1),
    event: z.looseObject({ type: z.string().min(1) }),
  }),
]);

type SlackCallback = Extract<z.infer<typeof envelopeSchema>, { type: "event_callback" }>;

export type SlackWebhookOptions = {
  signingSecret: string;
};

function verifySignature(body: string, headers: Headers, secret: string): boolean {
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Verify Slack requests and forward event deliveries without interpreting them. */
export function createSlackWebhookHandler(
  options: SlackWebhookOptions,
  receive: (delivery: EventDelivery & { payload: SlackCallback }) => Promise<boolean>,
): WebhookHandler {
  if (!options.signingSecret.trim()) throw new Error("Slack signing secret must not be empty.");

  return async (request) => {
    const body = await request.text();
    if (!verifySignature(body, request.headers, options.signingSecret)) {
      return new Response("Invalid Slack signature", { status: 401 });
    }

    let payload: z.infer<typeof envelopeSchema>;
    try {
      payload = envelopeSchema.parse(JSON.parse(body));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        return new Response("Invalid Slack payload", { status: 400 });
      }
      throw error;
    }

    if (payload.type === "url_verification") {
      return new Response(payload.challenge, { headers: { "content-type": "text/plain" } });
    }

    const accepted = await receive({ id: payload.event_id, name: payload.event.type, payload });
    return new Response(null, { status: accepted ? 200 : 204 });
  };
}
