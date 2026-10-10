import * as z from "zod";

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, "Must not be empty");

/** An event emitted by an integration for workflow matching and admission. */
export const integrationEventSchema = z.strictObject({
  /** Stable integration kind, such as `github` or `slack`. */
  integration: nonEmptyString,
  /** Stable configured installation, account, or connection identity. */
  instance: nonEmptyString,
  /** Delivery identity unique within the integration instance. */
  id: nonEmptyString,
  /** Integration-defined event name, such as `pull_request.opened`. */
  name: nonEmptyString,
  /** Integration-defined boundary against which workflows are matched. */
  scope: nonEmptyString,
  /** Stable identity used to route related events to one workflow session. */
  subject: nonEmptyString,
  /** Factual agent-facing description of the event. */
  content: nonEmptyString,
});

export type IntegrationEvent = z.infer<typeof integrationEventSchema>;
