import { defineEvent, type IntegrationContext } from "factory-oss/integration";

type SlackEventCallback<Event> = {
  team_id: string;
  event: Event;
};

type AppMentionEvent = {
  type: "app_mention";
  user: string;
  text: string;
  channel: string;
  ts: string;
  thread_ts?: string;
};

type MessageEvent = {
  type: "message";
  user?: string;
  text?: string;
  channel: string;
  channel_type: "channel" | "group";
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
};

export function createMessageEvents(_ctx: IntegrationContext) {
  return {
    appMention: defineEvent<SlackEventCallback<AppMentionEvent>>({
      name: "app_mention",
      description: "A user mentioned the Slack app.",
      execute({ payload }) {
        const { event } = payload;
        const thread = event.thread_ts ?? event.ts;
        return {
          subject: `workspace:${payload.team_id}:channel:${event.channel}:thread:${thread}`,
          content: `Slack user ${event.user} mentioned the app in channel ${event.channel}, thread ${thread}: ${event.text}`,
        };
      },
    }),

    channelMessage: defineEvent<SlackEventCallback<MessageEvent>>({
      name: "message.channels",
      description: "A user replied in a public Slack channel thread.",
      execute({ payload }) {
        const { event } = payload;
        if (!event.thread_ts || !event.user || event.bot_id || event.subtype) return undefined;
        return {
          subject: `workspace:${payload.team_id}:channel:${event.channel}:thread:${event.thread_ts}`,
          content: `Slack user ${event.user} replied in channel ${event.channel}, thread ${event.thread_ts}: ${event.text ?? ""}`,
        };
      },
    }),

    groupMessage: defineEvent<SlackEventCallback<MessageEvent>>({
      name: "message.groups",
      description: "A user replied in a private Slack channel thread.",
      execute({ payload }) {
        const { event } = payload;
        if (!event.thread_ts || !event.user || event.bot_id || event.subtype) return undefined;
        return {
          subject: `workspace:${payload.team_id}:channel:${event.channel}:thread:${event.thread_ts}`,
          content: `Slack user ${event.user} replied in channel ${event.channel}, thread ${event.thread_ts}: ${event.text ?? ""}`,
        };
      },
    }),
  };
}
