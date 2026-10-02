import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { DockerSandbox } from "../../sandbox.ts";
import type { GitHubClient } from "./app.ts";

export type GitHubPullRequestScope = {
  client: GitHubClient;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  headRef: string;
  appLogin: string;
  sandbox: DockerSandbox;
  onPush?: (headSha: string) => void;
};

export function createGitHubTools(scope: GitHubPullRequestScope) {
  const createReview = defineTool({
    name: "github_create_review",
    description: "Publish a review on the current GitHub pull request.",
    parameters: Type.Object({
      body: Type.String({ description: "Review summary" }),
      event: Type.Union([Type.Literal("COMMENT"), Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES")]),
      comments: Type.Optional(
        Type.Array(
          Type.Object({
            path: Type.String({ description: "Repository-relative file path" }),
            line: Type.Number({ description: "Line number in the pull request diff" }),
            side: Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")]),
            body: Type.String({ description: "Inline comment body" }),
          }),
        ),
      ),
    }),
    replay: "unsafe",
    execute: async ({ body, event, comments }) => {
      const review = await scope.client.request<{ id: number; html_url: string; state: string }>(
        "POST",
        `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repository)}/pulls/${scope.pullRequestNumber}/reviews`,
        { body, event, commit_id: scope.headSha, ...(comments ? { comments } : {}) },
      );
      return {
        content: [{ type: "text", text: `Published GitHub review ${review.html_url}` }],
        details: { id: review.id, url: review.html_url, state: review.state },
      };
    },
  });

  const createIssueComment = defineTool({
    name: "github_create_issue_comment",
    description: "Publish a comment in the current GitHub issue or pull request conversation.",
    parameters: Type.Object({ body: Type.String({ description: "Comment body" }) }),
    replay: "unsafe",
    execute: async ({ body }) => {
      const comment = await scope.client.request<{ id: number; html_url: string }>(
        "POST",
        `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repository)}/issues/${scope.pullRequestNumber}/comments`,
        { body },
      );
      return {
        content: [{ type: "text", text: `Published GitHub comment ${comment.html_url}` }],
        details: { id: comment.id, url: comment.html_url },
      };
    },
  });

  const pushChanges = defineTool({
    name: "github_push_changes",
    description:
      "Commit all current workspace changes and push them to the current pull request branch without force pushing.",
    parameters: Type.Object({ message: Type.String({ description: "Git commit message" }) }),
    replay: "unsafe",
    execute: async ({ message }) => {
      const bot = await scope.client.request<{ id: number; login: string }>(
        "GET",
        `/users/${encodeURIComponent(scope.appLogin)}`,
      );
      const identity = {
        name: bot.login,
        email: `${bot.id}+${bot.login}@users.noreply.github.com`,
      };
      const status = await scope.sandbox.exec("git status --porcelain", "/workspace");
      if (status.exitCode !== 0) throw new Error(status.stderr);
      if (status.stdout.trim()) {
        await scope.sandbox.write(".git/FACTORY_COMMIT_MESSAGE", message);
        const commit = await scope.sandbox.exec(
          `git add --all && git -c user.name=${shellQuote(identity.name)} -c user.email=${shellQuote(identity.email)} commit -F .git/FACTORY_COMMIT_MESSAGE; code=$?; rm -f .git/FACTORY_COMMIT_MESSAGE; exit $code`,
          "/workspace",
        );
        if (commit.exitCode !== 0) throw new Error(commit.stderr);
      }

      const head = await scope.sandbox.exec("git rev-parse HEAD", "/workspace");
      if (head.exitCode !== 0) throw new Error(head.stderr);
      if (head.stdout.trim() === scope.headSha) throw new Error("The workspace has no changes to push");
      const bundlePath = ".git/FACTORY_PUSH.bundle";
      const bundle = await scope.sandbox.exec(`git bundle create ${bundlePath} ${scope.headSha}..HEAD`, "/workspace");
      if (bundle.exitCode !== 0) throw new Error(bundle.stderr);
      const content = await scope.sandbox.readBinary(bundlePath);
      await scope.sandbox.exec(`rm -f ${bundlePath}`, "/workspace");
      const sha = await pushBundle(scope, content);
      scope.onPush?.(sha);
      return {
        content: [{ type: "text", text: `Pushed commit ${sha} to ${scope.headRef}` }],
        details: { sha, branch: scope.headRef },
      };
    },
  });

  const replyToReviewComment = defineTool({
    name: "github_reply_to_review_comment",
    description: "Reply to a top-level review comment on the current GitHub pull request.",
    parameters: Type.Object({
      commentId: Type.Number({ description: "Top-level review comment ID" }),
      body: Type.String({ description: "Reply text" }),
    }),
    replay: "unsafe",
    execute: async ({ commentId, body }) => {
      const comment = await scope.client.request<{ id: number; html_url: string }>(
        "POST",
        `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repository)}/pulls/${scope.pullRequestNumber}/comments/${commentId}/replies`,
        { body },
      );
      return {
        content: [{ type: "text", text: `Published GitHub reply ${comment.html_url}` }],
        details: { id: comment.id, url: comment.html_url },
      };
    },
  });

  return defineExtension({
    name: "github",
    tools: [createReview, createIssueComment, pushChanges, replyToReviewComment],
  });
}

async function pushBundle(scope: GitHubPullRequestScope, bundle: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factory-push-"));
  try {
    const repository = `https://github.com/${scope.owner}/${scope.repository}.git`;
    const environment = gitEnvironment(scope.client.token);
    await command(["git", "clone", "--branch", scope.headRef, "--single-branch", repository, directory], environment);
    const current = await output(["git", "-C", directory, "rev-parse", "HEAD"], environment);
    if (current.trim() !== scope.headSha) throw new Error("The pull request head changed; refusing to push");
    const bundlePath = join(directory, ".factory.bundle");
    await writeFile(bundlePath, bundle);
    await command(["git", "-C", directory, "fetch", bundlePath, "HEAD"], environment);
    await command(["git", "-C", directory, "checkout", "--detach", "FETCH_HEAD"], environment);
    await command(["git", "-C", directory, "push", "origin", `HEAD:${scope.headRef}`], environment);
    return (await output(["git", "-C", directory, "rev-parse", "HEAD"], environment)).trim();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function gitEnvironment(token: string): Record<string, string | undefined> {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function command(args: string[], env: Record<string, string | undefined>): Promise<void> {
  const child = Bun.spawn(args, { env, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`${args[1]} failed: ${stderr.trim()}`);
}

async function output(args: string[], env: Record<string, string | undefined>): Promise<string> {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${args[1]} failed: ${stderr.trim()}`);
  return stdout;
}
