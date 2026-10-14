import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type FilesCompleteUploadExternalArguments,
  type FilesGetUploadURLExternalArguments,
  type FilesInfoArguments,
  type FilesListArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createFileTools } from "./files.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;

test("get Slack file metadata", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    file: {
      id: "F1",
      name: "build.log",
      url_private_download: "https://files.slack.com/files-pri/T1-F1/download/build.log",
    },
  };
  const info = mock(async (_args: FilesInfoArguments) => response);
  client.files.info = info;
  const tools = createFileTools(client, {} as IntegrationContext);
  const args = { file: "F1" };

  const result = await tools.info.execute(args, api, context);

  expect(info).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("list a page of Slack files", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    files: [{ id: "F1", name: "build.log" }],
    paging: { count: 20, page: 2, pages: 3, total: 45 },
  };
  const list = mock(async (_args: FilesListArguments) => response);
  client.files.list = list;
  const tools = createFileTools(client, {} as IntegrationContext);
  const args = { channel: "C1", user: "U1", count: 20, page: 2, ts_from: "1700000000", types: "snippets" };

  const result = await tools.list.execute(args, api, context);

  expect(list).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("get a Slack file upload URL", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/v1/test" };
  const getUploadURLExternal = mock(async (_args: FilesGetUploadURLExternalArguments) => response);
  client.files.getUploadURLExternal = getUploadURLExternal;
  const tools = createFileTools(client, {} as IntegrationContext);
  const args = { filename: "build.log", length: 42, snippet_type: "text" };

  const result = await tools.getUploadURLExternal.execute(args, api, context);

  expect(getUploadURLExternal).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("complete a Slack file upload in a thread", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, files: [{ id: "F1", title: "Build log" }] };
  const completeUploadExternal = mock(async (_args: FilesCompleteUploadExternalArguments) => response);
  client.files.completeUploadExternal = completeUploadExternal;
  const tools = createFileTools(client, {} as IntegrationContext);
  const args = {
    files: [{ id: "F1", title: "Build log" }],
    channel_id: "C1",
    thread_ts: "1700000000.000001",
    initial_comment: "Here is the build log.",
  };

  const result = await tools.completeUploadExternal.execute(args, api, context);

  expect(completeUploadExternal).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
