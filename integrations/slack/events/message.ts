import type { AllMessageEvents, AppMentionEvent } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

// Canvas mention fields are documented but missing from the installed Slack types.
type MentionEvent = AppMentionEvent & {
  document_mention?: {
    file_id: string;
    section_id: string;
    mentioning_user_ids: string[];
  };
};

type SlackEventCallback<Event> = {
  team_id: string;
  event: Event & { action_token?: string };
};

/** Message subjects identify the parent thread so sibling replies share a conversation. */
export function createMessageEvents(client: WebClient, _ctx: IntegrationContext) {
  return {
    appMention: defineEvent<SlackEventCallback<MentionEvent>>({
      name: "app_mention",
      description: "A user mentioned the Slack app in a message or canvas.",
      execute({ payload }) {
        const { team_id, event } = payload;
        if (!event.user || event.bot_id) return undefined;

        switch (event.subtype) {
          case "document_mention": {
            const document = event.document_mention;
            if (!document) return undefined;
            let content = `Slack user ${event.user} mentioned the app in canvas ${document.file_id}, section ${document.section_id}: ${event.text}`;
            if (event.blocks?.length) content += `\nMention context: ${JSON.stringify(event.blocks)}`;
            if (event.action_token) content += `\nSearch action token (do not share): ${event.action_token}`;
            return {
              subject: `workspace:${team_id}:file:${document.file_id}:section:${document.section_id}`,
              content,
            };
          }
          case undefined:
          case "file_share": {
            const thread = event.thread_ts ?? event.ts;
            let content = `Slack user ${event.user} mentioned the app in channel ${event.channel}, thread ${thread}: ${event.text}`;
            if (event.files?.length) content += `\nFiles: ${event.files.map((file) => file.id).join(", ")}.`;
            if (event.action_token) content += `\nSearch action token (do not share): ${event.action_token}`;
            return {
              subject: `workspace:${team_id}:channel:${event.channel}:thread:${thread}`,
              content,
            };
          }
          default:
            return undefined;
        }
      },
    }),

    message: defineEvent<SlackEventCallback<AllMessageEvents>>({
      name: "message",
      description: "A user replied or edited a reply in a Slack channel thread.",
      async execute({ payload }) {
        const { team_id, event } = payload;
        // Edits wrap the original message; their envelope timestamp is not its identity.
        const message = event.subtype === "message_changed" ? event.message : event;
        switch (message.subtype) {
          case undefined:
          case "file_share":
          case "thread_broadcast":
            break;
          default:
            return undefined;
        }
        if (!message.user || ("bot_id" in message && message.bot_id)) return undefined;
        if ("display_as_bot" in message && message.display_as_bot) return undefined;
        const thread = message.thread_ts;
        if (!thread || message.ts === thread) return undefined;

        const text = message.text ?? "";
        const files = "files" in message ? (message.files ?? []) : [];
        const fileIds = files.map((file) => file.id).join(", ");
        if (event.subtype === "message_changed" && event.previous_message) {
          const previous = event.previous_message;
          const previousText = "text" in previous ? (previous.text ?? "") : "";
          const previousFiles = "files" in previous ? (previous.files ?? []) : [];
          if (text === previousText && fileIds === previousFiles.map((file) => file.id).join(", ")) {
            return undefined;
          }
        }

        if (event.channel_type !== "channel" && event.channel_type !== "group") {
          if (event.channel_type || event.subtype !== "message_changed") return undefined;
          // Slack can omit channel_type from edited-message envelopes.
          const response = await client.conversations.info({ channel: event.channel });
          if (!response.channel) throw new Error("Slack channel lookup did not return a channel.");
          if (response.channel.is_im || response.channel.is_mpim) return undefined;
        }

        const action = event.subtype === "message_changed" ? "edited a reply" : "replied";
        let content = `Slack user ${message.user} ${action} in channel ${event.channel}, thread ${thread}: ${text}`;
        if (fileIds) content += `\nFiles: ${fileIds}.`;
        if (event.action_token) content += `\nSearch action token (do not share): ${event.action_token}`;
        return {
          subject: `workspace:${team_id}:channel:${event.channel}:thread:${thread}`,
          content,
        };
      },
    }),
  };
}
