import type { JsonValue } from "@earendil-works/chord";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable";

/** Required access to the resource containing a tool. Independent of replay safety. */
export type ToolAccess = "read" | "write";

/** A Pi Durable tool with Factory permission metadata. */
export type IntegrationTool<Schema extends TSchema = TSchema, Details extends JsonValue = JsonValue> = ToolRegistration<
  Schema,
  Details
> & {
  readonly access: ToolAccess;
};

/** Plain-text shorthand that retains all other Pi Durable result fields. */
export type ToolResult<Details extends JsonValue = JsonValue> = Omit<ToolExecutionResult<Details>, "content"> & {
  readonly content: string;
};

export type ToolDefinition<Schema extends TSchema = TSchema, Details extends JsonValue = JsonValue> = Omit<
  IntegrationTool<Schema, Details>,
  "execute"
> & {
  execute(
    ...args: Parameters<ToolRegistration<Schema, Details>["execute"]>
  ): ToolResult<Details> | ToolExecutionResult<Details> | Promise<ToolResult<Details> | ToolExecutionResult<Details>>;
};

/** Infers schema arguments and adapts plain-text results to Pi Durable content blocks. */
export function defineTool<Schema extends TSchema, Details extends JsonValue = JsonValue>(
  definition: ToolDefinition<Schema, Details>,
): IntegrationTool<Schema, Details> {
  return {
    ...definition,
    async execute(...args) {
      const result = await definition.execute(...args);
      return {
        ...result,
        content: typeof result.content === "string" ? [{ type: "text", text: result.content }] : result.content,
      };
    },
  };
}
