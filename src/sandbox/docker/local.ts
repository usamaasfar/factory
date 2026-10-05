/**
 * Local Docker Sandboxes provider plan.
 *
 * This provider will use the standalone `sbx` CLI installed on the host. It
 * will create or reopen a stable sandbox for each Factory key, start it when
 * needed, adapt `sbx exec` to `SandboxCommandRunner`, and permanently remove it
 * through `SandboxProvider.destroy()`.
 *
 * Command execution must preserve cwd, environment, stdin, ordered stdout and
 * stderr streaming, nonzero exit codes, and cancellation. Cancellation must
 * stop the sandbox process before the runner settles. The provider will return
 * `FactorySandbox`; Pi filesystem and shell semantics remain in the shared
 * adapter.
 *
 * Local Docker Sandboxes require the host's native virtualization support:
 * KVM on Linux, Virtualization.framework on macOS, or Windows Hypervisor
 * Platform. Availability and setup failures should be reported clearly.
 */

export {};
