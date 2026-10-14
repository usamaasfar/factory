import type { FileSharedEvent } from "@slack/types";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

type SlackEventCallback<Event> = {
  team_id: string;
  event: Event;
};

export function createFileEvents(_ctx: IntegrationContext) {
  return {
    shared: defineEvent<SlackEventCallback<FileSharedEvent>>({
      name: "file_shared",
      description: "A user shared a Slack file.",
      execute({ payload }) {
        const { team_id, event } = payload;
        return {
          subject: `workspace:${team_id}:file:${event.file_id}`,
          content: `Slack user ${event.user_id} shared file ${event.file_id} in channel ${event.channel_id}.`,
        };
      },
    }),
  };
}
