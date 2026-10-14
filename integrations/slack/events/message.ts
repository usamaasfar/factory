import type { AllMessageEvents, AppMentionEvent } from "@slack/types";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

type SlackEventCallback<Event> = {
  team_id: string;
  event: Event;
};

export function createMessageEvents(_ctx: IntegrationContext) {
  return {
    appMention: defineEvent<SlackEventCallback<AppMentionEvent>>({
      name: "app_mention",
      description: "A user mentioned the Slack app.",
      execute({ payload }) {
        const { team_id, event } = payload;
        if (!event.user || event.bot_id || event.subtype) return undefined;
        const thread = event.thread_ts ?? event.ts;
        const reply = event.ts !== thread ? `:reply:${event.ts}` : "";
        return {
          subject: `workspace:${team_id}:channel:${event.channel}:thread:${thread}${reply}`,
          content: `Slack user ${event.user} mentioned the app in channel ${event.channel}, thread ${thread}: ${event.text}`,
        };
      },
    }),

    channelMessage: defineEvent<SlackEventCallback<AllMessageEvents>>({
      name: "message.channels",
      description: "A user replied in a public Slack channel thread.",
      execute({ payload }) {
        const { team_id, event } = payload;
        if (event.subtype) return undefined;
        if (
          event.channel_type !== "channel" ||
          !event.thread_ts ||
          !event.user ||
          event.bot_id ||
          event.ts === event.thread_ts
        ) {
          return undefined;
        }
        return {
          subject: `workspace:${team_id}:channel:${event.channel}:thread:${event.thread_ts}:reply:${event.ts}`,
          content: `Slack user ${event.user} replied in channel ${event.channel}, thread ${event.thread_ts}: ${event.text ?? ""}`,
        };
      },
    }),

    groupMessage: defineEvent<SlackEventCallback<AllMessageEvents>>({
      name: "message.groups",
      description: "A user replied in a private Slack channel thread.",
      execute({ payload }) {
        const { team_id, event } = payload;
        if (event.subtype) return undefined;
        if (
          event.channel_type !== "group" ||
          !event.thread_ts ||
          !event.user ||
          event.bot_id ||
          event.ts === event.thread_ts
        ) {
          return undefined;
        }
        return {
          subject: `workspace:${team_id}:channel:${event.channel}:thread:${event.thread_ts}:reply:${event.ts}`,
          content: `Slack user ${event.user} replied in channel ${event.channel}, thread ${event.thread_ts}: ${event.text ?? ""}`,
        };
      },
    }),
  };
}
