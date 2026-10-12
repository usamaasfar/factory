import { describe, expect, test } from "bun:test";
import { parseWorkflowDefinition } from "./definition.ts";

const source = `
name: Review pull requests
on:
  github.pull_request.opened:
  github.pull_request.synchronize:
permissions:
  github:
    contents: read
    pull_requests: write
  slack:
    conversations: read
    chat: write
sandbox:
  provider: provider-name
  environment: base.linux
  resources:
    cpu: 2
    memory: 4
    volume: 20
agent:
  provider: provider-name
  model: model-name
  instructions: Review the change.
`;

describe("workflow definitions", () => {
  test("parses and normalizes the strict DSL", () => {
    expect(parseWorkflowDefinition(source)).toEqual({
      name: "Review pull requests",
      on: {
        "github.pull_request.opened": null,
        "github.pull_request.synchronize": null,
      },
      permissions: {
        github: {
          contents: "read",
          pull_requests: "write",
        },
        slack: {
          conversations: "read",
          chat: "write",
        },
      },
      sandbox: {
        provider: "provider-name",
        environment: "base.linux",
        resources: { cpu: 2, memory: 4, volume: 20 },
      },
      agent: {
        provider: "provider-name",
        model: "model-name",
        instructions: "Review the change.",
      },
    });
  });
});
