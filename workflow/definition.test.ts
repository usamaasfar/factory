import { describe, expect, test } from "bun:test";
import { parseWorkflowDefinition } from "./definition.ts";

const source = `
name: Review pull requests
on:
  github.pull_request.opened:
agent:
  environment: base.linux
  resources:
    cpu: 2
    memory: 4
  provider: openai
  model: test-model
  instructions: Review the change.
`;

describe("workflow definitions", () => {
  test("parses and normalizes the strict DSL", () => {
    expect(parseWorkflowDefinition(source)).toEqual({
      name: "Review pull requests",
      on: { "github.pull_request.opened": {} },
      agent: {
        environment: "base.linux",
        resources: { cpu: 2, memory: 4 },
        provider: "openai",
        model: "test-model",
        instructions: "Review the change.",
      },
    });
  });

  test("rejects unknown fields and malformed event names", () => {
    expect(() => parseWorkflowDefinition(`${source}\nunknown: true`)).toThrow();
    expect(() => parseWorkflowDefinition(source.replace("github.pull_request.opened", "opened"))).toThrow(
      "Invalid event name",
    );
  });
});
