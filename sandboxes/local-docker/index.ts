import { createHash } from "node:crypto";
import Docker from "dockerode";
import type { Sandbox, SandboxProvider } from "factory-oss/sandbox";
import { DockerSandbox } from "./sandbox.ts";

const OWNER = "com.factory.sandbox";
const WORKSPACE = "/workspace";

export interface LocalDockerSandboxOptions {
  /** An already-built Linux image containing Bash, coreutils, and setsid. */
  readonly image: string;
  /** Defaults to Docker's standard socket / DOCKER_HOST configuration. */
  readonly socketPath?: string;
}

/** Infrastructure operations for stable sandbox keys. Lifecycle policy belongs to Factory. */
export function createLocalDockerSandboxProvider(options: LocalDockerSandboxOptions): SandboxProvider {
  const { image: imageName, socketPath } = options;
  if (!imageName) throw new TypeError("Docker sandbox image is required");
  const docker = new Docker(socketPath ? { socketPath } : undefined);
  return { open, suspend, destroy };

  async function open(key: string): Promise<Sandbox> {
    const resource = resources(key);
    const engine: unknown = await docker.info();
    if (
      typeof engine !== "object" ||
      engine === null ||
      !("ID" in engine) ||
      typeof engine.ID !== "string" ||
      !engine.ID
    ) {
      throw new Error("Docker did not provide a stable engine identity");
    }
    const image = await docker.getImage(imageName).inspect();
    let info = await optional(docker.getContainer(resource.container).inspect());
    if (info) validateContainer(info, resource, image.Id);

    const volume = await docker.createVolume({ Name: resource.volume, Labels: { [OWNER]: resource.identity } });
    owned((await volume.inspect()).Labels, resource);

    if (!info) {
      try {
        const container = await docker.createContainer({
          name: resource.container,
          Image: image.Id,
          Labels: { [OWNER]: resource.identity },
          WorkingDir: WORKSPACE,
          User: "0:0",
          Entrypoint: ["/usr/bin/sleep"],
          Cmd: ["infinity"],
          HostConfig: {
            Init: true,
            ReadonlyRootfs: true,
            Mounts: [{ Type: "volume", Source: resource.volume, Target: WORKSPACE }],
            Tmpfs: { "/tmp": "rw,nosuid,size=256m" },
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges"],
          },
        });
        info = await container.inspect();
      } catch (error) {
        // Another opener may have created the same deterministic container.
        if (!hasStatus(error, 409)) throw error;
        info = await docker.getContainer(resource.container).inspect();
      }
    }
    validateContainer(info, resource, image.Id);
    const container = docker.getContainer(info.Id);
    if (!info.State.Running) {
      try {
        await container.start();
      } catch (error) {
        if (!hasStatus(error, 304)) throw error;
      }
    }
    if (info.State.Paused) throw new Error("Docker sandbox was externally paused");
    return new DockerSandbox(container, `docker-local:${engine.ID}:${resource.identity}`);
  }

  async function suspend(key: string): Promise<void> {
    const resource = resources(key);
    const info = await optional(docker.getContainer(resource.container).inspect());
    if (!info) return;
    owned(info.Config.Labels, resource);
    // Use the inspected ID, never remove a different container that reused its name.
    await optional(docker.getContainer(info.Id).remove({ force: true, v: true }));
  }

  async function destroy(key: string): Promise<void> {
    const resource = resources(key);
    // Check both resources before deleting either one.
    const volume = docker.getVolume(resource.volume);
    const info = await optional(volume.inspect());
    if (info) owned(info.Labels, resource);
    await suspend(key);
    if (info) await optional(volume.remove());
  }
}

function resources(key: string) {
  if (!key) throw new TypeError("Sandbox key is required");
  const identity = createHash("sha256").update(key).digest("hex");
  const container = `factory-sandbox-${identity.slice(0, 32)}`;
  return { identity, container, volume: `${container}-workspace` };
}

function owned(labels: Record<string, string> | undefined, resource: ReturnType<typeof resources>): void {
  if (labels?.[OWNER] !== resource.identity)
    throw new Error(`Docker resource is not owned by this sandbox: ${resource.container}`);
}

function validateContainer(
  info: Docker.ContainerInspectInfo,
  resource: ReturnType<typeof resources>,
  image: string,
): void {
  owned(info.Config.Labels, resource);
  if (info.Image !== image) throw new Error("Existing sandbox uses a different image; suspend it before reopening");
  const mount = info.Mounts.find((mount) => mount.Destination === WORKSPACE);
  if (mount?.Type !== "volume" || mount.Name !== resource.volume || !mount.RW) {
    throw new Error("Existing sandbox has an unexpected workspace mount");
  }
}

async function optional<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
    return undefined;
  }
}

function hasStatus(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === code;
}
