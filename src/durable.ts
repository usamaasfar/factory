import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai/models";
import { createRegistry, type Extension, Harness } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";

export interface DurableOptions {
  models: Models;
  environment(conversationId: string, context: Context): Promise<ExecutionEnv>;
}

export interface Durable {
  harness: Harness;
  install(extension: Extension): void;
}

/** Opens Factory's Pi Durable harness using application-owned execution environments. */
export async function openDurable(databasePath: string, options: DurableOptions, context: Context): Promise<Durable> {
  await mkdir(dirname(databasePath), { recursive: true });

  const storage = await openNodeSqliteStorage(databasePath);
  const registry = createRegistry();
  registry.install(CodingTools);

  try {
    const harness = await Harness.open(
      storage,
      {
        models: options.models,
        registry,
        env: (target, envContext) => options.environment(String(target.conversationId), envContext),
      },
      context,
    );
    harness.resume();
    return { harness, install: (extension) => registry.install(extension) };
  } catch (error) {
    await storage.close(context);
    throw error;
  }
}
