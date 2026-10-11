import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { defineTool } from "./tool.ts";

const context = BACKGROUND_CONTEXT;
// The test tools do not use invocation APIs.
const api = {} as ToolExecutionApi;

test("adapts plain text without losing result metadata or execution arguments", async () => {
  const tool = defineTool({
    name: "comment",
    description: "Add a comment.",
    access: "write",
    replay: "safe",
    parameters: Type.Object({ body: Type.String() }),
    execute({ body }, invocation, executionContext) {
      expect(invocation).toBe(api);
      expect(executionContext).toBe(context);
      return {
        content: body,
        isError: true,
        details: { reason: "rejected" },
        diagnostics: [{ severity: "warn", message: "Rejected" }],
        control: { terminate: true },
      };
    },
  });

  expect(tool.access).toBe("write");
  expect(tool.replay).toBe("safe");
  expect(await tool.execute({ body: "hello" }, api, context)).toEqual({
    content: [{ type: "text", text: "hello" }],
    isError: true,
    details: { reason: "rejected" },
    diagnostics: [{ severity: "warn", message: "Rejected" }],
    control: { terminate: true },
  });
});

test.each<ToolExecutionResult>([{ content: [{ type: "text", text: "native" }] }, { details: { streamed: true } }, {}])(
  "preserves native results: %j",
  async (result) => {
    const tool = defineTool({
      name: "read",
      description: "Read.",
      access: "read",
      parameters: Type.Object({}),
      execute: () => result,
    });

    expect(await tool.execute({}, api, context)).toEqual(result);
  },
);

test("propagates execution errors", async () => {
  const error = new Error("Provider failed");
  const tool = defineTool({
    name: "read",
    description: "Read.",
    access: "read",
    parameters: Type.Object({}),
    execute() {
      throw error;
    },
  });

  await expect(tool.execute({}, api, context)).rejects.toBe(error);
});
