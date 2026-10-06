import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { getOrThrow } from "@earendil-works/pi-durable/env";

/** Returns the commit currently recorded for an origin tracking branch. */
export async function findRemoteBranchHead(
  env: ExecutionEnv,
  branch: string,
  context: Context,
): Promise<string | undefined> {
  let output = "";
  const result = getOrThrow(
    await env.exec(
      'ref="refs/remotes/origin/$FACTORY_BRANCH"\n' +
        'git check-ref-format "$ref" || exit 64\n' +
        'git show-ref --verify --hash "$ref"',
      { env: { FACTORY_BRANCH: branch }, onOutput: (chunk) => (output += chunk) },
      context,
    ),
  );
  if (result.exitCode === 1 || result.exitCode === 128) return undefined;
  if (result.exitCode === 64) throw new Error(`Invalid Git branch: ${branch}`);
  if (result.exitCode !== 0) throw new Error(`Could not read origin/${branch} (exit ${result.exitCode})`);
  return output.trim();
}

/** Advances an origin tracking ref without changing the checkout. */
export async function updateRemoteBranchHead(
  env: ExecutionEnv,
  branch: string,
  head: string,
  context: Context,
): Promise<void> {
  const result = getOrThrow(
    await env.exec(
      'ref="refs/remotes/origin/$FACTORY_BRANCH"\n' +
        'git check-ref-format "$ref" || exit 64\n' +
        'git update-ref "$ref" "$FACTORY_HEAD"',
      { env: { FACTORY_BRANCH: branch, FACTORY_HEAD: commitId(head) } },
      context,
    ),
  );
  if (result.exitCode !== 0) throw new Error(`Could not update origin/${branch} (exit ${result.exitCode})`);
}

/** Imports Git objects and advances an origin tracking ref without changing the checkout. */
export async function importCodingWorkspaceChanges(
  env: ExecutionEnv,
  options: { branch: string; head: string; bundle: Uint8Array },
  context: Context,
): Promise<void> {
  const head = commitId(options.head);
  if (options.bundle.length === 0) throw new Error("Git bundle is empty");

  const path = getOrThrow(await env.createTempFile({ prefix: "factory-fetch-", suffix: ".bundle" }, context));
  try {
    getOrThrow(await env.writeFile(path, options.bundle, context));
    const result = getOrThrow(
      await env.exec(
        'ref="refs/remotes/origin/$FACTORY_BRANCH"\n' +
          'git check-ref-format "$ref" || exit 64\n' +
          'git bundle verify "$FACTORY_BUNDLE" || exit 65\n' +
          'git fetch "$FACTORY_BUNDLE" HEAD || exit 66\n' +
          'test "$(git rev-parse FETCH_HEAD)" = "$FACTORY_HEAD" || exit 67\n' +
          'git update-ref "$ref" "$FACTORY_HEAD"',
        {
          env: {
            FACTORY_BRANCH: options.branch,
            FACTORY_HEAD: head,
            FACTORY_BUNDLE: path,
          },
        },
        context,
      ),
    );
    if (result.exitCode !== 0) throw new Error(`Could not import Git bundle (exit ${result.exitCode})`);
  } finally {
    await env.remove(path, { force: true }, withoutAbortSignal(context));
  }
}

function commitId(value: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) throw new TypeError("Head must be a full Git commit ID");
  return value.toLowerCase();
}
