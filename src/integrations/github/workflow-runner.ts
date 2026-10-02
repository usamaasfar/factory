import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { buildEnvironment } from "../../environment.ts";
import { runAgent } from "../../harness.ts";
import { DockerSandbox } from "../../sandbox.ts";
import { parseWorkflow } from "../../workflow.ts";
import type { GitHubApp } from "./app.ts";
import { GitHubInstanceStore } from "./instances.ts";
import { createGitHubTools } from "./tools.ts";
import type { GitHubPullRequestEvent, GitHubWebhookEvent } from "./webhook.ts";

export type GitHubWorkflowOptions = {
  app: GitHubApp;
  database: string;
  instances: string;
  appLogin: string;
};

export async function handleGitHubEvent(event: GitHubWebhookEvent, options: GitHubWorkflowOptions): Promise<void> {
  if (event.type === "issue_comment.created" || event.type === "pull_request_review_comment.created") {
    return continueConversation(event, options);
  }
  if (event.type !== "pull_request.opened" && event.type !== "pull_request.synchronize") return;

  const client = await options.app.installationClient(event.installationId, event.repository.id);
  const workflowSource = await client.file(
    event.repository.owner,
    event.repository.name,
    ".factory/workflows/review.yml",
    event.pullRequest.baseSha,
  );
  const workflow = parseWorkflow(Bun.YAML.parse(workflowSource));
  if (!workflow.triggers.includes(`github.${event.type}`)) return;

  const environmentSource = await client.file(
    event.repository.owner,
    event.repository.name,
    `.factory/environments/${workflow.agent.environment}`,
    event.pullRequest.baseSha,
  );
  const image = await buildEnvironment(environmentSource);
  const workflowPath = ".factory/workflows/review.yml";
  const store = new GitHubInstanceStore(options.instances);
  const existing = store
    .find(event.repository.id, event.pullRequest.number)
    .find((instance) => instance.workflowPath === workflowPath);
  const volume = existing?.volume ?? `factory-github-${event.repository.id}-pr-${event.pullRequest.number}`;
  const sandbox = await DockerSandbox.start(image, { volume });

  try {
    await checkoutPullRequest(event, client.token, sandbox);
    const github = createGitHubTools({
      client,
      owner: event.repository.owner,
      repository: event.repository.name,
      pullRequestNumber: event.pullRequest.number,
      headSha: event.pullRequest.headSha,
      headRef: event.pullRequest.headRef,
      appLogin: options.appLogin,
      sandbox,
    });
    const result = await runAgent({
      sandbox,
      database: options.database,
      model: workflow.agent.model,
      instructions: workflow.agent.instructions,
      requestId: event.deliveryId,
      extensions: [github],
      conversationId: existing?.conversationId,
      prompt: eventPrompt(event),
    });
    store.save({
      repositoryId: event.repository.id,
      pullRequestNumber: event.pullRequest.number,
      workflowPath,
      conversationId: result.conversationId,
      volume,
      image,
      model: workflow.agent.model,
      instructions: workflow.agent.instructions,
      headSha: event.pullRequest.headSha,
      headRef: event.pullRequest.headRef,
    });
  } finally {
    await sandbox.stop();
  }
}

async function checkoutPullRequest(
  event: GitHubPullRequestEvent,
  token: string,
  sandbox: DockerSandbox,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "factory-checkout-"));
  try {
    const repository = `https://github.com/${event.repository.fullName}.git`;
    await git(["clone", repository, directory], token);
    await git(["-C", directory, "checkout", "--detach", event.pullRequest.headSha], token);
    await git(["-C", directory, "remote", "remove", "origin"], token);

    const cleared = await sandbox.exec("find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +", "/workspace");
    if (cleared.exitCode !== 0) throw new Error(`Could not clear sandbox workspace: ${cleared.stderr}`);
    await copyDirectory(directory, sandbox);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function git(args: string[], token: string): Promise<void> {
  const child = Bun.spawn(["git", ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
}

async function copyDirectory(sourceRoot: string, sandbox: DockerSandbox): Promise<void> {
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const destination = relative(sourceRoot, source).split(sep).join("/");
    await sandbox.writeBinary(destination, await readFile(source));
  }
}

async function continueConversation(
  event: Extract<GitHubWebhookEvent, { type: "issue_comment.created" | "pull_request_review_comment.created" }>,
  options: GitHubWorkflowOptions,
): Promise<void> {
  const store = new GitHubInstanceStore(options.instances);
  const instances = store.find(event.repository.id, event.pullRequest.number);
  if (instances.length === 0) return;
  if (instances.length > 1)
    throw new Error(`Multiple workflows are active for pull request #${event.pullRequest.number}`);
  const instance = instances[0];
  if (!instance) return;

  const client = await options.app.installationClient(event.installationId, event.repository.id);
  const sandbox = await DockerSandbox.start(instance.image, { volume: instance.volume });
  try {
    const github = createGitHubTools({
      client,
      owner: event.repository.owner,
      repository: event.repository.name,
      pullRequestNumber: event.pullRequest.number,
      headSha: instance.headSha,
      headRef: instance.headRef,
      appLogin: options.appLogin,
      sandbox,
      onPush: (headSha) =>
        store.updateHead(event.repository.id, event.pullRequest.number, instance.workflowPath, headSha),
    });
    await runAgent({
      sandbox,
      database: options.database,
      model: instance.model,
      instructions: instance.instructions,
      requestId: event.deliveryId,
      extensions: [github],
      conversationId: instance.conversationId,
      prompt: commentPrompt(event),
    });
  } finally {
    await sandbox.stop();
  }
}

function commentPrompt(
  event: Extract<GitHubWebhookEvent, { type: "issue_comment.created" | "pull_request_review_comment.created" }>,
): string {
  const delivery =
    event.type === "issue_comment.created"
      ? "If you respond, deliver it through github_create_issue_comment."
      : `If you respond, use github_reply_to_review_comment with commentId ${event.comment.inReplyToId ?? event.comment.id}.`;
  return `GitHub event: ${event.type}\nSender: ${event.sender.login}\nComment ID: ${event.comment.id}\n\n${event.comment.body}\n\n${delivery}`;
}

function eventPrompt(event: GitHubPullRequestEvent): string {
  return `GitHub event: github.${event.type}
Repository: ${event.repository.fullName}
Pull request: #${event.pullRequest.number} ${event.pullRequest.title}
Base SHA: ${event.pullRequest.baseSha}
Head SHA: ${event.pullRequest.headSha}

The workspace is checked out at the event's head SHA. Handle this event according to the workflow instructions.`;
}
