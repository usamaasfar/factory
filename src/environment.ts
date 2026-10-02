import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX_DIRECTORY = join(import.meta.dir, "sandbox");

export async function buildEnvironment(source: string): Promise<string> {
  const protocol = await readFile(join(SANDBOX_DIRECTORY, "protocol.ts"));
  const server = await readFile(join(SANDBOX_DIRECTORY, "server.ts"));
  const digest = createHash("sha256").update(source).update(protocol).update(server).digest("hex").slice(0, 16);
  const image = `factory-environment:${digest}`;
  if (await imageExists(image)) return image;

  const context = await mkdtemp(join(tmpdir(), "factory-environment-"));
  try {
    await writeFile(join(context, "environment"), source, { mode: 0o755 });
    await cp(join(SANDBOX_DIRECTORY, "protocol.ts"), join(context, "protocol.ts"));
    await cp(join(SANDBOX_DIRECTORY, "server.ts"), join(context, "server.ts"));
    await writeFile(
      join(context, "Dockerfile"),
      `FROM debian:bookworm-slim
COPY environment /tmp/environment
RUN /tmp/environment && rm /tmp/environment
WORKDIR /opt/factory
COPY protocol.ts server.ts ./
RUN mkdir /workspace
ENV FACTORY_WORKSPACE=/workspace
WORKDIR /workspace
ENTRYPOINT ["bun", "run", "/opt/factory/server.ts"]
`,
    );
    await command(["docker", "build", "--tag", image, context]);
    return image;
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}

async function imageExists(image: string): Promise<boolean> {
  const process = Bun.spawn(["docker", "image", "inspect", image], { stdout: "ignore", stderr: "ignore" });
  return (await process.exited) === 0;
}

async function command(args: string[]): Promise<void> {
  const process = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`${args[0]} exited with code ${exitCode}`);
}
