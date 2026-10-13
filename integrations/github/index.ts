import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { defineIntegration, defineResource } from "factory-oss/integration";
import { createIssueCommentEvents } from "./events/issue-comment.ts";
import { createPullRequestEvents } from "./events/pull-request.ts";
import { createPullTools } from "./tools/pulls.ts";
import { createReactionTools } from "./tools/reactions.ts";
import { createGitHubWebhookHandler } from "./webhook.ts";

/** Experimental PR slice: one authenticated client, explicit event/tool registrations. */
export const createGitHubIntegration = defineIntegration((ctx) => {
  const appId = Bun.env.GITHUB_APP_ID?.trim();
  const privateKey = Bun.env.GITHUB_PRIVATE_KEY?.trim();
  const webhookSecret = Bun.env.GITHUB_WEBHOOK_SECRET?.trim();
  const installation = Bun.env.GITHUB_INSTALLATION_ID?.trim();
  const repository = Bun.env.GITHUB_REPOSITORY_ID?.trim();
  if (!appId || !privateKey || !webhookSecret || !installation || !repository) {
    throw new Error(
      "GitHub requires GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, GITHUB_INSTALLATION_ID, and GITHUB_REPOSITORY_ID.",
    );
  }

  const installationId = Number(installation);
  const repositoryId = Number(repository);

  const client = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: appId,
      privateKey: privateKey,
      installationId: installationId,
      repositoryIds: [repositoryId],
    },
  });
  const pullTools = createPullTools(client, ctx);
  const reactionTools = createReactionTools(client, ctx);
  const pullRequestEvents = createPullRequestEvents(ctx);
  const issueCommentEvents = createIssueCommentEvents(ctx);
  const webhookUrl = ctx.webhook.register(
    createGitHubWebhookHandler(
      {
        secret: webhookSecret,
        installationId: installationId,
        repositoryId: repositoryId,
      },
      ctx,
    ),
  );

  return {
    name: "github",
    webhookUrl,
    events: [...Object.values(pullRequestEvents), ...Object.values(issueCommentEvents)],
    resources: [
      defineResource({ name: "pull_requests", tools: Object.values(pullTools) }),
      defineResource({ name: "reactions", tools: Object.values(reactionTools) }),
    ],
  };
});

export default createGitHubIntegration;
