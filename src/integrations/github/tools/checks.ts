import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const page = Type.Optional(Type.Number({ description: "Page number." }));
const perPage = Type.Optional(Type.Number({ description: "Results per page, up to 100." }));

export function createCheckTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_get_check_run",
      description: "Get a GitHub check run.",
      parameters: Type.Object({ owner, repository, checkRun: Type.Number({ description: "Check run ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, checkRun }) =>
        output(await github.rest.checks.get({ owner, repo: repository, check_run_id: checkRun })),
    }),
    defineTool({
      name: "github_get_check_suite",
      description: "Get a GitHub check suite.",
      parameters: Type.Object({ owner, repository, checkSuite: Type.Number({ description: "Check suite ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, checkSuite }) =>
        output(await github.rest.checks.getSuite({ owner, repo: repository, check_suite_id: checkSuite })),
    }),
    defineTool({
      name: "github_list_check_run_annotations",
      description: "List annotations produced by a GitHub check run.",
      parameters: Type.Object({
        owner,
        repository,
        checkRun: Type.Number({ description: "Check run ID." }),
        page,
        perPage,
      }),
      replay: "safe",
      execute: async ({ owner, repository, checkRun, page, perPage }) =>
        output(
          await github.rest.checks.listAnnotations({
            owner,
            repo: repository,
            check_run_id: checkRun,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_check_runs_for_ref",
      description: "List GitHub check runs for a commit SHA, branch, or tag.",
      parameters: Type.Object({ owner, repository, ref: Type.String(), page, perPage }),
      replay: "safe",
      execute: async ({ owner, repository, ref, page, perPage }) =>
        output(await github.rest.checks.listForRef({ owner, repo: repository, ref, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_list_check_runs_for_suite",
      description: "List GitHub check runs belonging to a check suite.",
      parameters: Type.Object({
        owner,
        repository,
        checkSuite: Type.Number({ description: "Check suite ID." }),
        page,
        perPage,
      }),
      replay: "safe",
      execute: async ({ owner, repository, checkSuite, page, perPage }) =>
        output(
          await github.rest.checks.listForSuite({
            owner,
            repo: repository,
            check_suite_id: checkSuite,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_check_suites_for_ref",
      description: "List GitHub check suites for a commit SHA, branch, or tag.",
      parameters: Type.Object({ owner, repository, ref: Type.String(), page, perPage }),
      replay: "safe",
      execute: async ({ owner, repository, ref, page, perPage }) =>
        output(await github.rest.checks.listSuitesForRef({ owner, repo: repository, ref, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_rerequest_check_run",
      description: "Request that a GitHub check provider run an existing check again.",
      parameters: Type.Object({ owner, repository, checkRun: Type.Number({ description: "Check run ID." }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, checkRun }) => {
        await github.rest.checks.rerequestRun({ owner, repo: repository, check_run_id: checkRun });
        return text(`Rerequested check run ${checkRun}.`);
      },
    }),
    defineTool({
      name: "github_rerequest_check_suite",
      description: "Request that a GitHub check provider run an existing check suite again.",
      parameters: Type.Object({ owner, repository, checkSuite: Type.Number({ description: "Check suite ID." }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, checkSuite }) => {
        await github.rest.checks.rerequestSuite({ owner, repo: repository, check_suite_id: checkSuite });
        return text(`Rerequested check suite ${checkSuite}.`);
      },
    }),
  ];
}

function output(response: { data: unknown }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}
