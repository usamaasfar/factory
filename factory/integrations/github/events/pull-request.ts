import { defineEvent, type IntegrationContext } from "factory-oss/integration";
import * as z from "zod";

export function createPullRequestOpenedEvent(_ctx: IntegrationContext) {
  return defineEvent({
    name: "pull_request.opened",
    description: "A pull request was opened.",
    parameters: z.object({
      action: z.literal("opened"),
      installation: z.object({ id: z.number().int().positive() }),
      repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }),
      number: z.number().int().positive(),
      sender: z.object({ login: z.string().min(1) }),
      pull_request: z.object({ title: z.string() }),
    }),
    execute({ id, payload }) {
      return {
        integration: "github",
        instance: String(payload.installation.id),
        id,
        name: "pull_request.opened",
        scope: String(payload.repository.id),
        subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
        content: `@${payload.sender.login} opened PR #${payload.number} in ${payload.repository.full_name}: ${payload.pull_request.title}`,
      };
    },
  });
}

export function createPullRequestReopenedEvent(_ctx: IntegrationContext) {
  return defineEvent({
    name: "pull_request.reopened",
    description: "A pull request was reopened.",
    parameters: z.object({
      action: z.literal("reopened"),
      installation: z.object({ id: z.number().int().positive() }),
      repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }),
      number: z.number().int().positive(),
      sender: z.object({ login: z.string().min(1) }),
    }),
    execute({ id, payload }) {
      return {
        integration: "github",
        instance: String(payload.installation.id),
        id,
        name: "pull_request.reopened",
        scope: String(payload.repository.id),
        subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
        content: `@${payload.sender.login} reopened PR #${payload.number} in ${payload.repository.full_name}.`,
      };
    },
  });
}

export function createPullRequestSynchronizeEvent(_ctx: IntegrationContext) {
  return defineEvent({
    name: "pull_request.synchronize",
    description: "New commits were pushed to a pull request.",
    parameters: z.object({
      action: z.literal("synchronize"),
      installation: z.object({ id: z.number().int().positive() }),
      repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }),
      number: z.number().int().positive(),
      sender: z.object({ login: z.string().min(1) }),
    }),
    execute({ id, payload }) {
      return {
        integration: "github",
        instance: String(payload.installation.id),
        id,
        name: "pull_request.synchronize",
        scope: String(payload.repository.id),
        subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
        content: `@${payload.sender.login} pushed new commits to PR #${payload.number} in ${payload.repository.full_name}.`,
      };
    },
  });
}

export function createPullRequestReadyForReviewEvent(_ctx: IntegrationContext) {
  return defineEvent({
    name: "pull_request.ready_for_review",
    description: "A pull request was marked ready for review.",
    parameters: z.object({
      action: z.literal("ready_for_review"),
      installation: z.object({ id: z.number().int().positive() }),
      repository: z.object({ id: z.number().int().positive(), full_name: z.string().min(1) }),
      number: z.number().int().positive(),
      sender: z.object({ login: z.string().min(1) }),
    }),
    execute({ id, payload }) {
      return {
        integration: "github",
        instance: String(payload.installation.id),
        id,
        name: "pull_request.ready_for_review",
        scope: String(payload.repository.id),
        subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
        content: `@${payload.sender.login} marked PR #${payload.number} in ${payload.repository.full_name} ready for review.`,
      };
    },
  });
}
