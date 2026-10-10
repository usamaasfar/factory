import type { LinearClient } from "@linear/sdk";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

type IssueUpdateInput = Parameters<LinearClient["updateIssue"]>[1];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createIssueTools(client: LinearClient, _ctx: IntegrationContext) {
  return {
    read: defineTool({
      name: "linear_read_issue",
      description: "Read a Linear issue and its discussion.",
      parameters: Type.Object({
        issueId: Type.String({ minLength: 1, description: "Issue UUID or identifier." }),
        cursor: Type.Optional(Type.String({ minLength: 1, description: "Comment pagination cursor." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Comments to return." })),
      }),
      replay: "safe",
      async execute({ issueId, cursor, limit }, _api, context) {
        try {
          context.abortSignal?.throwIfAborted();
          const issue = await client.issue(issueId);
          const [state, assignee, team, labels, comments] = await Promise.all([
            issue.state,
            issue.assignee,
            issue.team,
            issue.labels({ first: 100 }),
            issue.comments({ before: cursor, last: limit ?? 50 }),
          ]);
          const authors = await Promise.all(
            comments.nodes.map(async (comment) => {
              const [user, externalUser] = await Promise.all([comment.user, comment.externalUser]);
              return user?.name ?? externalUser?.name ?? comment.botActor?.name ?? "unknown";
            }),
          );
          context.abortSignal?.throwIfAborted();

          const formattedLabels = labels.nodes.map((label) => label.name).join(", ") || "none";
          const formattedComments =
            comments.nodes
              .map((comment, index) => `[${comment.createdAt.toISOString()}] ${authors[index]}: ${comment.body}`)
              .join("\n") || "none";
          const previousCursor = comments.pageInfo.hasPreviousPage ? comments.pageInfo.startCursor : undefined;
          const pagination = previousCursor ? `\nPrevious comment cursor: ${previousCursor}` : "";
          const issueDetails = [
            `${issue.identifier}: ${issue.title}`,
            `Status: ${state?.name ?? "unknown"}`,
            `Priority: ${issue.priorityLabel}`,
            `Assignee: ${assignee?.name ?? "unassigned"}`,
            `Team: ${team?.name ?? "unknown"} (${issue.teamId ?? "unknown"})`,
            `Labels: ${formattedLabels}`,
            `URL: ${issue.url}`,
          ].join("\n");

          return {
            content: `${issueDetails}\n\nDescription:\n${issue.description ?? "none"}\n\nComments (showing ${comments.nodes.length}):\n${formattedComments}${pagination}`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return { content: `Failed to read the Linear issue: ${errorMessage(error)}` };
        }
      },
    }),

    search: defineTool({
      name: "linear_search_issues",
      description: "Search Linear issues for duplicates or related work.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        teamId: Type.Optional(Type.String({ minLength: 1 })),
        cursor: Type.Optional(Type.String({ minLength: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      }),
      replay: "safe",
      async execute({ query, teamId, cursor, limit }, _api, context) {
        try {
          context.abortSignal?.throwIfAborted();
          const result = await client.searchIssues(query, { after: cursor, first: limit ?? 10, teamId });
          const states = await Promise.all(result.nodes.map((issue) => issue.state));
          context.abortSignal?.throwIfAborted();

          const issues =
            result.nodes
              .map((issue, index) => {
                const state = states[index]?.name ?? "unknown";
                return `${issue.identifier}: ${issue.title} (${state}, ${issue.priorityLabel})`;
              })
              .join("\n") || "none";
          const nextCursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined;
          const pagination = nextCursor ? `\nNext cursor: ${nextCursor}` : "";

          return {
            content: `Found ${result.totalCount} Linear issues; showing ${result.nodes.length}:\n${issues}${pagination}`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return { content: `Failed to search Linear issues: ${errorMessage(error)}` };
        }
      },
    }),

    listTriageOptions: defineTool({
      name: "linear_list_triage_options",
      description: "List the statuses, labels, members, and priorities available for a Linear issue.",
      parameters: Type.Object({
        issueId: Type.String({ minLength: 1, description: "Issue UUID or identifier." }),
      }),
      replay: "safe",
      async execute({ issueId }, _api, context) {
        try {
          context.abortSignal?.throwIfAborted();
          const issue = await client.issue(issueId);
          const team = await issue.team;
          if (!team) throw new Error("The issue has no team.");

          const [states, labels, members] = await Promise.all([
            team.states({ first: 100 }),
            team.labels({ first: 100 }),
            team.members({ first: 100 }),
          ]);
          context.abortSignal?.throwIfAborted();

          const priorities = "No priority (0)\nUrgent (1)\nHigh (2)\nMedium (3)\nLow (4)";
          const formattedStates =
            states.nodes.map((state) => `${state.name} [${state.type}] (${state.id})`).join("\n") || "none";
          const formattedLabels = labels.nodes.map((label) => `${label.name} (${label.id})`).join("\n") || "none";
          const formattedMembers =
            members.nodes.map((member) => `${member.name} <${member.email}> (${member.id})`).join("\n") || "none";

          return {
            content: `Triage options for ${issue.identifier} in ${team.name} (${team.id}):\n\nPriorities:\n${priorities}\n\nStatuses:\n${formattedStates}\n\nLabels:\n${formattedLabels}\n\nMembers:\n${formattedMembers}`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return { content: `Failed to list Linear triage options: ${errorMessage(error)}` };
        }
      },
    }),

    update: defineTool({
      name: "linear_update_issue",
      description: "Update a Linear issue's priority, status, assignee, or labels.",
      parameters: Type.Object({
        issueId: Type.String({ minLength: 1, description: "Issue UUID or identifier." }),
        priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
        stateId: Type.Optional(Type.String({ minLength: 1 })),
        assigneeId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
        addLabelIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
        removeLabelIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
      }),
      replay: "unsafe",
      async execute({ issueId, priority, stateId, assigneeId, addLabelIds, removeLabelIds }, _api, context) {
        const input: IssueUpdateInput = {
          priority,
          stateId,
          assigneeId,
          addedLabelIds: addLabelIds,
          removedLabelIds: removeLabelIds,
        };
        const updatedFields = [
          priority !== undefined ? "priority" : undefined,
          stateId !== undefined ? "status" : undefined,
          assigneeId !== undefined ? "assignee" : undefined,
          addLabelIds !== undefined ? "labels added" : undefined,
          removeLabelIds !== undefined ? "labels removed" : undefined,
        ].filter((field): field is string => field !== undefined);
        if (updatedFields.length === 0) return { content: "No Linear issue updates were provided." };

        try {
          context.abortSignal?.throwIfAborted();
          const result = await client.updateIssue(issueId, input);
          if (!result.success) throw new Error("Linear did not update the issue.");

          return { content: `Updated Linear issue ${issueId}: ${updatedFields.join(", ")}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return { content: `Failed to update the Linear issue: ${errorMessage(error)}` };
        }
      },
    }),
  };
}
