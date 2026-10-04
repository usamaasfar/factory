import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const issue = Type.Number({ description: "Issue or pull request number." });
const comment = Type.Number({ description: "Issue comment ID." });
const milestone = Type.Number({ description: "Milestone number." });
const page = Type.Optional(Type.Number({ description: "Page number." }));
const perPage = Type.Optional(Type.Number({ description: "Results per page, up to 100." }));
const repo = { owner, repository };
const subject = { ...repo, issue };
const paged = { page, perPage };

export function createIssueTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_create_issue",
      description: "Create a GitHub issue.",
      parameters: Type.Object({
        ...repo,
        title: Type.String(),
        body: Type.Optional(Type.String()),
        assignees: Type.Optional(Type.Array(Type.String())),
        labels: Type.Optional(Type.Array(Type.String())),
        milestone: Type.Optional(Type.Number()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, title, body, assignees, labels, milestone }) =>
        output(await github.rest.issues.create({ owner, repo: repository, title, body, assignees, labels, milestone })),
    }),
    defineTool({
      name: "github_get_issue",
      description: "Get a GitHub issue or pull request.",
      parameters: Type.Object(subject),
      replay: "safe",
      execute: async ({ owner, repository, issue }) =>
        output(await github.rest.issues.get({ owner, repo: repository, issue_number: issue })),
    }),
    defineTool({
      name: "github_list_repository_issues",
      description: "List issues and pull requests in a repository.",
      parameters: Type.Object({
        ...repo,
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
        labels: Type.Optional(Type.String({ description: "Comma-separated label names." })),
        ...paged,
      }),
      replay: "safe",
      execute: async ({ owner, repository, state, labels, page, perPage }) =>
        output(
          await github.rest.issues.listForRepo({ owner, repo: repository, state, labels, page, per_page: perPage }),
        ),
    }),
    defineTool({
      name: "github_update_issue",
      description: "Update a GitHub issue or pull request.",
      parameters: Type.Object({
        ...subject,
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])),
        stateReason: Type.Optional(
          Type.Union([Type.Literal("completed"), Type.Literal("not_planned"), Type.Literal("reopened")]),
        ),
        milestone: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
        assignees: Type.Optional(Type.Array(Type.String())),
        labels: Type.Optional(Type.Array(Type.String())),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, title, body, state, stateReason, milestone, assignees, labels }) =>
        output(
          await github.rest.issues.update({
            owner,
            repo: repository,
            issue_number: issue,
            title,
            body,
            state,
            state_reason: stateReason,
            milestone,
            assignees,
            labels,
          }),
        ),
    }),

    defineTool({
      name: "github_create_issue_comment",
      description: "Create an ordinary comment on a GitHub issue or pull request.",
      parameters: Type.Object({
        ...subject,
        body: Type.String({ description: "Comment body in GitHub-flavored Markdown." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, body }) =>
        output(await github.rest.issues.createComment({ owner, repo: repository, issue_number: issue, body })),
    }),
    defineTool({
      name: "github_get_issue_comment",
      description: "Get an issue or pull request comment.",
      parameters: Type.Object({ ...repo, comment }),
      replay: "safe",
      execute: async ({ owner, repository, comment }) =>
        output(await github.rest.issues.getComment({ owner, repo: repository, comment_id: comment })),
    }),
    defineTool({
      name: "github_list_issue_comments",
      description: "List comments on an issue or pull request.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listComments({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_update_issue_comment",
      description: "Update an issue or pull request comment.",
      parameters: Type.Object({ ...repo, comment, body: Type.String() }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment, body }) =>
        output(await github.rest.issues.updateComment({ owner, repo: repository, comment_id: comment, body })),
    }),
    defineTool({
      name: "github_delete_issue_comment",
      description: "Delete an issue or pull request comment.",
      parameters: Type.Object({ ...repo, comment }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment }) => {
        await github.rest.issues.deleteComment({ owner, repo: repository, comment_id: comment });
        return text(`Deleted issue comment ${comment}.`);
      },
    }),

    defineTool({
      name: "github_add_issue_assignees",
      description: "Add assignees to an issue or pull request.",
      parameters: Type.Object({ ...subject, assignees: Type.Array(Type.String(), { minItems: 1, maxItems: 10 }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, assignees }) =>
        output(await github.rest.issues.addAssignees({ owner, repo: repository, issue_number: issue, assignees })),
    }),
    defineTool({
      name: "github_remove_issue_assignees",
      description: "Remove assignees from an issue or pull request.",
      parameters: Type.Object({ ...subject, assignees: Type.Array(Type.String(), { minItems: 1 }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, assignees }) =>
        output(await github.rest.issues.removeAssignees({ owner, repo: repository, issue_number: issue, assignees })),
    }),
    defineTool({
      name: "github_list_issue_assignees",
      description: "List users who can be assigned issues in a repository.",
      parameters: Type.Object({ ...repo, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, page, perPage }) =>
        output(await github.rest.issues.listAssignees({ owner, repo: repository, page, per_page: perPage })),
    }),

    defineTool({
      name: "github_add_issue_labels",
      description: "Add labels to an issue or pull request.",
      parameters: Type.Object({ ...subject, labels: Type.Array(Type.String(), { minItems: 1 }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, labels }) =>
        output(await github.rest.issues.addLabels({ owner, repo: repository, issue_number: issue, labels })),
    }),
    defineTool({
      name: "github_set_issue_labels",
      description: "Replace all labels on an issue or pull request.",
      parameters: Type.Object({ ...subject, labels: Type.Array(Type.String()) }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, labels }) =>
        output(await github.rest.issues.setLabels({ owner, repo: repository, issue_number: issue, labels })),
    }),
    defineTool({
      name: "github_remove_issue_label",
      description: "Remove a label from an issue or pull request.",
      parameters: Type.Object({ ...subject, label: Type.String() }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, label }) =>
        output(await github.rest.issues.removeLabel({ owner, repo: repository, issue_number: issue, name: label })),
    }),
    defineTool({
      name: "github_get_label",
      description: "Get a repository label.",
      parameters: Type.Object({ ...repo, label: Type.String() }),
      replay: "safe",
      execute: async ({ owner, repository, label }) =>
        output(await github.rest.issues.getLabel({ owner, repo: repository, name: label })),
    }),
    defineTool({
      name: "github_list_repository_labels",
      description: "List labels in a repository.",
      parameters: Type.Object({ ...repo, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, page, perPage }) =>
        output(await github.rest.issues.listLabelsForRepo({ owner, repo: repository, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_list_issue_labels",
      description: "List labels on an issue or pull request.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listLabelsOnIssue({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_create_label",
      description: "Create a repository label.",
      parameters: Type.Object({
        ...repo,
        name: Type.String(),
        color: Type.String({ description: "Six-character hexadecimal color without #." }),
        description: Type.Optional(Type.String()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, name, color, description }) =>
        output(await github.rest.issues.createLabel({ owner, repo: repository, name, color, description })),
    }),
    defineTool({
      name: "github_update_label",
      description: "Update a repository label.",
      parameters: Type.Object({
        ...repo,
        label: Type.String({ description: "Current label name." }),
        name: Type.Optional(Type.String({ description: "New label name." })),
        color: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, label, name, color, description }) =>
        output(
          await github.rest.issues.updateLabel({
            owner,
            repo: repository,
            name: label,
            new_name: name,
            color,
            description,
          }),
        ),
    }),

    defineTool({
      name: "github_get_milestone",
      description: "Get a repository milestone.",
      parameters: Type.Object({ ...repo, milestone }),
      replay: "safe",
      execute: async ({ owner, repository, milestone }) =>
        output(await github.rest.issues.getMilestone({ owner, repo: repository, milestone_number: milestone })),
    }),
    defineTool({
      name: "github_list_milestones",
      description: "List repository milestones.",
      parameters: Type.Object({
        ...repo,
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
        ...paged,
      }),
      replay: "safe",
      execute: async ({ owner, repository, state, page, perPage }) =>
        output(await github.rest.issues.listMilestones({ owner, repo: repository, state, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_create_milestone",
      description: "Create a repository milestone.",
      parameters: Type.Object({
        ...repo,
        title: Type.String(),
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])),
        description: Type.Optional(Type.String()),
        dueOn: Type.Optional(Type.String({ description: "ISO 8601 timestamp." })),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, title, state, description, dueOn }) =>
        output(
          await github.rest.issues.createMilestone({
            owner,
            repo: repository,
            title,
            state,
            description,
            due_on: dueOn,
          }),
        ),
    }),
    defineTool({
      name: "github_update_milestone",
      description: "Update a repository milestone.",
      parameters: Type.Object({
        ...repo,
        milestone,
        title: Type.Optional(Type.String()),
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])),
        description: Type.Optional(Type.String()),
        dueOn: Type.Optional(Type.String({ description: "ISO 8601 timestamp." })),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, milestone, title, state, description, dueOn }) =>
        output(
          await github.rest.issues.updateMilestone({
            owner,
            repo: repository,
            milestone_number: milestone,
            title,
            state,
            description,
            due_on: dueOn,
          }),
        ),
    }),

    defineTool({
      name: "github_get_issue_event",
      description: "Get an issue event.",
      parameters: Type.Object({ ...repo, event: Type.Number({ description: "Issue event ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, event }) =>
        output(await github.rest.issues.getEvent({ owner, repo: repository, event_id: event })),
    }),
    defineTool({
      name: "github_list_issue_events",
      description: "List events for an issue or pull request.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listEvents({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_issue_timeline",
      description: "List timeline events for an issue or pull request.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listEventsForTimeline({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),

    defineTool({
      name: "github_add_blocking_issue",
      description: "Mark an issue as blocked by another issue.",
      parameters: Type.Object({
        ...subject,
        blockingIssueId: Type.Number({ description: "Database ID of the blocking issue." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, blockingIssueId }) =>
        output(
          await github.rest.issues.addBlockedByDependency({
            owner,
            repo: repository,
            issue_number: issue,
            issue_id: blockingIssueId,
          }),
        ),
    }),
    defineTool({
      name: "github_remove_blocking_issue",
      description: "Remove a blocked-by relationship from an issue.",
      parameters: Type.Object({
        ...subject,
        blockingIssueId: Type.Number({ description: "Database ID of the blocking issue." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, blockingIssueId }) =>
        output(
          await github.rest.issues.removeDependencyBlockedBy({
            owner,
            repo: repository,
            issue_number: issue,
            issue_id: blockingIssueId,
          }),
        ),
    }),
    defineTool({
      name: "github_list_issues_blocking_issue",
      description: "List issues that block an issue.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listDependenciesBlockedBy({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_issues_blocked_by_issue",
      description: "List issues blocked by an issue.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listDependenciesBlocking({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),

    defineTool({
      name: "github_add_sub_issue",
      description: "Add a sub-issue to an issue.",
      parameters: Type.Object({
        ...subject,
        subIssueId: Type.Number({ description: "Database ID of the sub-issue." }),
        replaceParent: Type.Optional(Type.Boolean()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, subIssueId, replaceParent }) =>
        output(
          await github.rest.issues.addSubIssue({
            owner,
            repo: repository,
            issue_number: issue,
            sub_issue_id: subIssueId,
            replace_parent: replaceParent,
          }),
        ),
    }),
    defineTool({
      name: "github_remove_sub_issue",
      description: "Remove a sub-issue from an issue.",
      parameters: Type.Object({
        ...subject,
        subIssueId: Type.Number({ description: "Database ID of the sub-issue." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, subIssueId }) =>
        output(
          await github.rest.issues.removeSubIssue({
            owner,
            repo: repository,
            issue_number: issue,
            sub_issue_id: subIssueId,
          }),
        ),
    }),
    defineTool({
      name: "github_reprioritize_sub_issue",
      description: "Move a sub-issue before or after another sub-issue.",
      parameters: Type.Object({
        ...subject,
        subIssueId: Type.Number(),
        afterId: Type.Optional(Type.Number()),
        beforeId: Type.Optional(Type.Number()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, issue, subIssueId, afterId, beforeId }) =>
        output(
          await github.rest.issues.reprioritizeSubIssue({
            owner,
            repo: repository,
            issue_number: issue,
            sub_issue_id: subIssueId,
            after_id: afterId,
            before_id: beforeId,
          }),
        ),
    }),
    defineTool({
      name: "github_list_sub_issues",
      description: "List the sub-issues of an issue.",
      parameters: Type.Object({ ...subject, ...paged }),
      replay: "safe",
      execute: async ({ owner, repository, issue, page, perPage }) =>
        output(
          await github.rest.issues.listSubIssues({
            owner,
            repo: repository,
            issue_number: issue,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_get_parent_issue",
      description: "Get the parent of a sub-issue.",
      parameters: Type.Object(subject),
      replay: "safe",
      execute: async ({ owner, repository, issue }) =>
        output(await github.rest.issues.getParent({ owner, repo: repository, issue_number: issue })),
    }),
  ];
}

function output(response: { data: unknown }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}
