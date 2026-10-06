import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { suspendWorkspaceAfterSubmission } from "../../workflow/runtime.ts";
import { isGitHubAppSender } from "./handler.ts";

test("GitHub App events are distinguished from the human account with the same base login", () => {
  expect(isGitHubAppSender("usamaasfar[bot]", "usamaasfar")).toBeTrue();
  expect(isGitHubAppSender("UsamaAsfar[bot]", "usamaasfar[BOT]")).toBeTrue();
  expect(isGitHubAppSender("usamaasfar", "usamaasfar")).toBeFalse();
  expect(isGitHubAppSender("contributor", "usamaasfar")).toBeFalse();
});

test("workflow compute is suspended only after its conversation becomes idle", async () => {
  let settleSubmission: (() => void) | undefined;
  const submissionSettled = new Promise<void>((resolve) => {
    settleSubmission = resolve;
  });
  let becomeIdle: (() => void) | undefined;
  const conversationIdle = new Promise<void>((resolve) => {
    becomeIdle = resolve;
  });
  const suspended: string[] = [];

  const operation = suspendWorkspaceAfterSubmission(
    { wait: async () => (await submissionSettled) as never },
    { waitForIdle: async () => conversationIdle },
    {
      suspend: async (workspaceId) => {
        suspended.push(workspaceId);
      },
    },
    "workflow-1",
    BACKGROUND_CONTEXT,
  );

  settleSubmission?.();
  await Promise.resolve();
  expect(suspended).toEqual([]);

  becomeIdle?.();
  await operation;
  expect(suspended).toEqual(["workflow-1"]);
});
