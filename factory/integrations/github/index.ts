import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { defineIntegration } from "factory-oss/integration";
import {
  createPullRequestOpenedEvent,
  createPullRequestReadyForReviewEvent,
  createPullRequestReopenedEvent,
  createPullRequestSynchronizeEvent,
} from "./events/pull-request.ts";
import { createCommentTool } from "./tools/issues.ts";
import { createReadTool } from "./tools/pulls.ts";
import { createGitHubWebhookHandler } from "./webhook.ts";

export type GitHubOptions = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId: number;
  repositoryId: number;
};

/** One installation-authenticated client shared by GitHub tools. */
export const createGitHubIntegration = defineIntegration((options: GitHubOptions, ctx) => {
  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: options.appId,
      privateKey: options.privateKey,
      installationId: options.installationId,
      repositoryIds: [options.repositoryId],
    },
  });
  const webhookUrl = ctx.webhook.register(
    createGitHubWebhookHandler(
      {
        secret: options.webhookSecret,
        installationId: options.installationId,
        repositoryId: options.repositoryId,
      },
      ctx,
    ),
  );

  return {
    webhookUrl,
    events: [
      createPullRequestOpenedEvent(ctx),
      createPullRequestReopenedEvent(ctx),
      createPullRequestSynchronizeEvent(ctx),
      createPullRequestReadyForReviewEvent(ctx),
    ],
    tools: [createReadTool(client, ctx), createCommentTool(client, ctx)],
  };
});

export default createGitHubIntegration;
