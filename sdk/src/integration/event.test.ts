import { expect, test } from "bun:test";
import { defineEvent } from "./event.ts";

const event = defineEvent({
  name: "issue.opened",
  description: "An issue opened.",
  parameters: {
    parse(value: unknown) {
      if (typeof value !== "string") throw new TypeError("Expected an issue ID");
      return { id: value };
    },
  },
  execute: ({ id, payload }) => (payload.id === "ignored" ? undefined : { subject: payload.id, content: id }),
});

test("parses event payloads and preserves delivery IDs", () => {
  expect(event.execute({ id: "delivery", name: event.name, payload: "issue-1" })).toEqual({
    subject: "issue-1",
    content: "delivery",
  });
});

test("preserves ignored events", () => {
  expect(event.execute({ id: "delivery", name: event.name, payload: "ignored" })).toBeUndefined();
});

test("rejects invalid payloads", () => {
  expect(() => event.execute({ id: "delivery", name: event.name, payload: 42 })).toThrow(TypeError);
});
