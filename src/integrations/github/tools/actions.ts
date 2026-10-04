import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const workflow = Type.Union([Type.String(), Type.Number()], { description: "Workflow file name or ID." });
const run = Type.Number({ description: "Workflow run ID." });
const job = Type.Number({ description: "Workflow job ID." });
const page = Type.Optional(Type.Number({ description: "Page number." }));
const perPage = Type.Optional(Type.Number({ description: "Results per page, up to 100." }));
const repo = { owner, repository };
const paged = { page, perPage };

export function createActionTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_get_workflow",
      description: "Get a GitHub Actions workflow.",
      parameters: Type.Object({ ...repo, workflow }),
      replay: "safe",
      execute: async ({ owner, repository, workflow }) =>
        output(await github.rest.actions.getWorkflow({ owner, repo: repository, workflow_id: workflow })),
    }),
    defineTool({
      name: "github_list_repository_workflows",
      description: "List GitHub Actions workflows in a repository.",
      parameters: Type.Object({ ...repo, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, page, perPage }) =>
        output(await github.rest.actions.listRepoWorkflows({ owner, repo: repository, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_dispatch_workflow",
      description: "Dispatch a GitHub Actions workflow.",
      parameters: Type.Object({
        ...repo,
        workflow,
        ref: Type.String({ description: "Git ref to run." }),
        inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, workflow, ref, inputs }) => {
        await github.rest.actions.createWorkflowDispatch({
          owner,
          repo: repository,
          workflow_id: workflow,
          ref,
          inputs,
        });
        return text(`Dispatched workflow ${workflow}.`);
      },
    }),
    defineTool({
      name: "github_enable_workflow",
      description: "Enable a GitHub Actions workflow.",
      parameters: Type.Object({ ...repo, workflow }),
      replay: "unsafe",
      execute: async ({ owner, repository, workflow }) => {
        await github.rest.actions.enableWorkflow({ owner, repo: repository, workflow_id: workflow });
        return text(`Enabled workflow ${workflow}.`);
      },
    }),
    defineTool({
      name: "github_disable_workflow",
      description: "Disable a GitHub Actions workflow.",
      parameters: Type.Object({ ...repo, workflow }),
      replay: "unsafe",
      execute: async ({ owner, repository, workflow }) => {
        await github.rest.actions.disableWorkflow({ owner, repo: repository, workflow_id: workflow });
        return text(`Disabled workflow ${workflow}.`);
      },
    }),

    defineTool({
      name: "github_get_workflow_run",
      description: "Get a GitHub Actions workflow run.",
      parameters: Type.Object({ ...repo, run }),
      replay: "safe",
      execute: async ({ owner, repository, run }) =>
        output(await github.rest.actions.getWorkflowRun({ owner, repo: repository, run_id: run })),
    }),
    defineTool({
      name: "github_get_workflow_run_attempt",
      description: "Get a specific attempt of a workflow run.",
      parameters: Type.Object({ ...repo, run, attempt: Type.Number({ description: "Attempt number." }) }),
      replay: "safe",
      execute: async ({ owner, repository, run, attempt }) =>
        output(
          await github.rest.actions.getWorkflowRunAttempt({
            owner,
            repo: repository,
            run_id: run,
            attempt_number: attempt,
          }),
        ),
    }),
    defineTool({
      name: "github_list_workflow_runs",
      description: "List runs for a GitHub Actions workflow.",
      parameters: Type.Object({ ...repo, workflow, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, workflow, page, perPage }) =>
        output(
          await github.rest.actions.listWorkflowRuns({
            owner,
            repo: repository,
            workflow_id: workflow,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_repository_workflow_runs",
      description: "List all workflow runs in a repository.",
      parameters: Type.Object({ ...repo, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, page, perPage }) =>
        output(await github.rest.actions.listWorkflowRunsForRepo({ owner, repo: repository, page, per_page: perPage })),
    }),

    defineTool({
      name: "github_get_workflow_job",
      description: "Get a job from a workflow run.",
      parameters: Type.Object({ ...repo, job }),
      replay: "safe",
      execute: async ({ owner, repository, job }) =>
        output(await github.rest.actions.getJobForWorkflowRun({ owner, repo: repository, job_id: job })),
    }),
    defineTool({
      name: "github_list_workflow_run_jobs",
      description: "List jobs for a workflow run.",
      parameters: Type.Object({ ...repo, run, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, run, page, perPage }) =>
        output(
          await github.rest.actions.listJobsForWorkflowRun({
            owner,
            repo: repository,
            run_id: run,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_workflow_run_attempt_jobs",
      description: "List jobs for a specific workflow run attempt.",
      parameters: Type.Object({ ...repo, run, attempt: Type.Number({ description: "Attempt number." }), ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, run, attempt, page, perPage }) =>
        output(
          await github.rest.actions.listJobsForWorkflowRunAttempt({
            owner,
            repo: repository,
            run_id: run,
            attempt_number: attempt,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_cancel_workflow_run",
      description: "Cancel a workflow run.",
      parameters: Type.Object({ ...repo, run }),
      replay: "unsafe",
      execute: async ({ owner, repository, run }) => {
        await github.rest.actions.cancelWorkflowRun({ owner, repo: repository, run_id: run });
        return text(`Cancelled workflow run ${run}.`);
      },
    }),
    defineTool({
      name: "github_rerun_workflow_job",
      description: "Re-run a workflow job and its dependent jobs.",
      parameters: Type.Object({ ...repo, job, enableDebugLogging: Type.Optional(Type.Boolean()) }),
      replay: "unsafe",
      execute: async ({ owner, repository, job, enableDebugLogging }) => {
        await github.rest.actions.reRunJobForWorkflowRun({
          owner,
          repo: repository,
          job_id: job,
          enable_debug_logging: enableDebugLogging,
        });
        return text(`Requested re-run of workflow job ${job}.`);
      },
    }),
    defineTool({
      name: "github_rerun_workflow",
      description: "Re-run a workflow run.",
      parameters: Type.Object({ ...repo, run, enableDebugLogging: Type.Optional(Type.Boolean()) }),
      replay: "unsafe",
      execute: async ({ owner, repository, run, enableDebugLogging }) => {
        await github.rest.actions.reRunWorkflow({
          owner,
          repo: repository,
          run_id: run,
          enable_debug_logging: enableDebugLogging,
        });
        return text(`Requested re-run of workflow run ${run}.`);
      },
    }),
    defineTool({
      name: "github_rerun_failed_workflow_jobs",
      description: "Re-run failed jobs and their dependent jobs in a workflow run.",
      parameters: Type.Object({ ...repo, run, enableDebugLogging: Type.Optional(Type.Boolean()) }),
      replay: "unsafe",
      execute: async ({ owner, repository, run, enableDebugLogging }) => {
        await github.rest.actions.reRunWorkflowFailedJobs({
          owner,
          repo: repository,
          run_id: run,
          enable_debug_logging: enableDebugLogging,
        });
        return text(`Requested re-run of failed jobs in workflow run ${run}.`);
      },
    }),
    defineTool({
      name: "github_get_artifact",
      description: "Get metadata for a GitHub Actions artifact.",
      parameters: Type.Object({ ...repo, artifact: Type.Number({ description: "Artifact ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, artifact }) =>
        output(await github.rest.actions.getArtifact({ owner, repo: repository, artifact_id: artifact })),
    }),
    defineTool({
      name: "github_list_repository_artifacts",
      description: "List GitHub Actions artifacts in a repository.",
      parameters: Type.Object({ ...repo, name: Type.Optional(Type.String()), ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, name, page, perPage }) =>
        output(
          await github.rest.actions.listArtifactsForRepo({ owner, repo: repository, name, page, per_page: perPage }),
        ),
    }),
    defineTool({
      name: "github_list_workflow_run_artifacts",
      description: "List artifacts produced by a workflow run.",
      parameters: Type.Object({ ...repo, run, name: Type.Optional(Type.String()), ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, run, name, page, perPage }) =>
        output(
          await github.rest.actions.listWorkflowRunArtifacts({
            owner,
            repo: repository,
            run_id: run,
            name,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_actions_caches",
      description: "List GitHub Actions caches in a repository.",
      parameters: Type.Object({
        ...repo,
        ref: Type.Optional(Type.String()),
        key: Type.Optional(Type.String()),
        ...paged,
      }),
      replay: "safe",
      execute: async ({ owner, repository, ref, key, page, perPage }) =>
        output(
          await github.rest.actions.getActionsCacheList({ owner, repo: repository, ref, key, page, per_page: perPage }),
        ),
    }),
    defineTool({
      name: "github_get_actions_cache_usage",
      description: "Get GitHub Actions cache usage for a repository.",
      parameters: Type.Object(repo),
      replay: "safe",
      execute: async ({ owner, repository }) =>
        output(await github.rest.actions.getActionsCacheUsage({ owner, repo: repository })),
    }),

    defineTool({
      name: "github_get_allowed_actions",
      description: "Get the actions and reusable workflows allowed in a repository.",
      parameters: Type.Object(repo),
      replay: "safe",
      execute: async ({ owner, repository }) =>
        output(await github.rest.actions.getAllowedActionsRepository({ owner, repo: repository })),
    }),
    defineTool({
      name: "github_get_default_workflow_permissions",
      description: "Get default GITHUB_TOKEN workflow permissions for a repository.",
      parameters: Type.Object(repo),
      replay: "safe",
      execute: async ({ owner, repository }) =>
        output(
          await github.rest.actions.getGithubActionsDefaultWorkflowPermissionsRepository({ owner, repo: repository }),
        ),
    }),
    defineTool({
      name: "github_get_actions_permissions",
      description: "Get the GitHub Actions permissions policy for a repository.",
      parameters: Type.Object(repo),
      replay: "safe",
      execute: async ({ owner, repository }) =>
        output(await github.rest.actions.getGithubActionsPermissionsRepository({ owner, repo: repository })),
    }),
    defineTool({
      name: "github_get_workflow_access",
      description: "Get access granted to workflows outside a private repository.",
      parameters: Type.Object(repo),
      replay: "safe",
      execute: async ({ owner, repository }) =>
        output(await github.rest.actions.getWorkflowAccessToRepository({ owner, repo: repository })),
    }),
  ];
}

// TODO: Implement these as file-producing tools after Pi has a host-file result abstraction:
// - actions.downloadJobLogsForWorkflowRun
// - actions.downloadWorkflowRunLogs
// - actions.downloadWorkflowRunAttemptLogs
// - actions.downloadArtifact

function output(response: { data: unknown }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}
