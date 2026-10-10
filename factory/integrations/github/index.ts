import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { defineIntegration } from "factory-oss/integration";
import { createIssueCommentEvents } from "./events/issue-comment.ts";
import { createPullRequestEvents } from "./events/pull-request.ts";
import { createPullTools } from "./tools/pulls.ts";
import { createReactionTools } from "./tools/reactions.ts";
import { createGitHubWebhookHandler } from "./webhook.ts";

export type GitHubOptions = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId: number;
  repositoryId: number;
};

/** Experimental PR slice: one authenticated client, explicit event/tool registrations. */
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
  const pullTools = createPullTools(client, ctx);
  const reactionTools = createReactionTools(client, ctx);
  const pullRequestEvents = createPullRequestEvents(ctx);
  const issueCommentEvents = createIssueCommentEvents(ctx);
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
    events: [...Object.values(pullRequestEvents), ...Object.values(issueCommentEvents)],
    tools: [...Object.values(pullTools), ...Object.values(reactionTools)],
  };
});

export default createGitHubIntegration;
