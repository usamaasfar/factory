import { expect, test } from "bun:test";
import { integrationEventSchema } from "./integration.ts";

const event = {
  integration: "github",
  instance: "installation:456",
  id: "delivery-789",
  name: "pull_request.opened",
  scope: "repository:123",
  subject: "pull_request:42",
  content: "Pull request #42 was opened.",
};

test("accepts a normalized integration event", () => {
  expect(integrationEventSchema.parse(event)).toEqual(event);
});

test("rejects empty fields and unknown properties", () => {
  expect(integrationEventSchema.safeParse({ ...event, subject: " " }).success).toBe(false);
  expect(integrationEventSchema.safeParse({ ...event, payload: {} }).success).toBe(false);
});
