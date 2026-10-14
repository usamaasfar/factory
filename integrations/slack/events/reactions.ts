import type { ReactionAddedEvent, ReactionRemovedEvent } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

// Slack's types cover message reactions; its reference also documents legacy file items.
type ReactionItem =
  | ReactionAddedEvent["item"]
  | { type: "file"; file: string }
  | { type: "file_comment"; file: string; file_comment: string };

type SlackEventCallback<Event> = {
  team_id: string;
  event: Omit<Event, "item"> & { item: ReactionItem };
};

export function createReactionEvents(client: WebClient, _ctx: IntegrationContext) {
  return {
    added: defineEvent<SlackEventCallback<ReactionAddedEvent>>({
      name: "reaction_added",
      description: "A user added an emoji reaction to a Slack item.",
      async execute({ payload }) {
        const { team_id, event } = payload;
        const { item } = event;
        switch (item.type) {
          case "message": {
            const response = await client.reactions.get({ channel: item.channel, timestamp: item.ts });
            const message = response.message;
            if (!message) throw new Error("Slack reaction lookup did not return a message.");
            const thread =
              "thread_ts" in message && typeof message.thread_ts === "string" ? message.thread_ts : item.ts;
            const reply = item.ts !== thread ? `:reply:${item.ts}` : "";
            return {
              subject: `workspace:${team_id}:channel:${item.channel}:thread:${thread}${reply}`,
              content: `Slack user ${event.user} added :${event.reaction}: to message ${item.ts}.`,
            };
          }
          case "file":
            return {
              subject: `workspace:${team_id}:file:${item.file}`,
              content: `Slack user ${event.user} added :${event.reaction}: to file ${item.file}.`,
            };
          case "file_comment":
            return {
              subject: `workspace:${team_id}:file:${item.file}:comment:${item.file_comment}`,
              content: `Slack user ${event.user} added :${event.reaction}: to file comment ${item.file_comment}.`,
            };
        }
      },
    }),

    removed: defineEvent<SlackEventCallback<ReactionRemovedEvent>>({
      name: "reaction_removed",
      description: "A user removed an emoji reaction from a Slack item.",
      async execute({ payload }) {
        const { team_id, event } = payload;
        const { item } = event;
        switch (item.type) {
          case "message": {
            const response = await client.reactions.get({ channel: item.channel, timestamp: item.ts });
            const message = response.message;
            if (!message) throw new Error("Slack reaction lookup did not return a message.");
            const thread =
              "thread_ts" in message && typeof message.thread_ts === "string" ? message.thread_ts : item.ts;
            const reply = item.ts !== thread ? `:reply:${item.ts}` : "";
            return {
              subject: `workspace:${team_id}:channel:${item.channel}:thread:${thread}${reply}`,
              content: `Slack user ${event.user} removed :${event.reaction}: from message ${item.ts}.`,
            };
          }
          case "file":
            return {
              subject: `workspace:${team_id}:file:${item.file}`,
              content: `Slack user ${event.user} removed :${event.reaction}: from file ${item.file}.`,
            };
          case "file_comment":
            return {
              subject: `workspace:${team_id}:file:${item.file}:comment:${item.file_comment}`,
              content: `Slack user ${event.user} removed :${event.reaction}: from file comment ${item.file_comment}.`,
            };
        }
      },
    }),
  };
}
