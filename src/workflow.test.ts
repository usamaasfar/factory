import { describe, expect, test } from "bun:test";
import { loadWorkflow, parseWorkflow } from "./workflow.ts";

describe("workflow", () => {
  test("loads the manual workflow fixture", async () => {
    expect(await loadWorkflow("tests/.factory/workflows/manual.yml")).toEqual({
      name: "Uppercase input",
      triggers: ["manual"],
      agent: {
        environment: "test.linux",
        provider: "deepseek",
        model: "deepseek-flash",
        instructions:
          "Read input.txt.\nCreate output.txt containing the uppercase version of its contents.\nPreserve the trailing newline.\nRead output.txt and verify the result before finishing.\n",
      },
    });
  });

  test("rejects workflows without triggers", () => {
    expect(() =>
      parseWorkflow({
        name: "Invalid",
        on: {},
        agent: { environment: "test.linux", provider: "deepseek", model: "deepseek-flash", instructions: "Run" },
      }),
    ).toThrow("at least one trigger");
  });
});
