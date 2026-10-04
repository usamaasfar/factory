import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { Sandboxes } from "./sandbox/index.ts";

export interface DurableOptions {
  models: Models;
  image: string;
}

export interface Durable {
  harness: Harness;
  sandboxes: Sandboxes;
}

/** Opens Factory's Pi Durable harness with one sandbox per conversation. */
export async function openDurable(databasePath: string, options: DurableOptions, context: Context): Promise<Durable> {
  await mkdir(dirname(databasePath), { recursive: true });

  const storage = await openNodeSqliteStorage(databasePath);
  const registry = createRegistry();
  const sandboxes = new Sandboxes({ image: options.image });
  registry.install(CodingTools);

  try {
    const harness = await Harness.open(
      storage,
      {
        models: options.models,
        registry,
        env: (target, envContext) => sandboxes.open(target.conversationId, envContext),
      },
      context,
    );
    harness.resume();
    return { harness, sandboxes };
  } catch (error) {
    await storage.close(context);
    throw error;
  }
}
