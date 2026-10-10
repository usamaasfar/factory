import { LinearClient } from "@linear/sdk";
import { defineIntegration } from "factory-oss/integration";
import { createCommentTool } from "./tools/comment.ts";
import { createReadTool } from "./tools/issue.ts";

export type LinearOptions = {
  apiKey: string;
};

/** One authenticated SDK client shared by Linear tools. */
export const createLinearIntegration = defineIntegration((options: LinearOptions, ctx) => {
  const client = new LinearClient({ apiKey: options.apiKey });
  return { tools: [createReadTool(client, ctx), createCommentTool(client, ctx)] };
});

export default createLinearIntegration;
