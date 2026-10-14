import { expect, test } from "bun:test";
import type { IntegrationContext } from "factory-oss/integration";
import { createFileEvents } from "./files.ts";

test("a shared file retains its file identity", async () => {
  const { shared } = createFileEvents({} as IntegrationContext);

  const result = await shared.execute({
    id: "Ev1",
    name: "file_shared",
    payload: {
      team_id: "T1",
      event: {
        type: "file_shared",
        file_id: "F1",
        file: { id: "F1" },
        user_id: "U1",
        channel_id: "C1",
        event_ts: "1700000001.000001",
      },
    },
  });

  expect(result).toEqual({
    subject: "workspace:T1:file:F1",
    content: "Slack user U1 shared file F1 in channel C1.",
  });
});
