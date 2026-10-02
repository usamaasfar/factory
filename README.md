# Factory

Factory is a workflow engineering platform for automating repeatable software work—such as reviewing code, triaging issues, and fixing bugs—in isolated sandboxes.

Workflows and their execution environments are defined in `.factory/`.

## Workflow DSL

Factory has a declarative YAML workflow DSL. A workflow selects the events that activate a long-lived agent and defines its trusted environment, resources, model, and instructions.

```yaml
name: Review pull requests

on:
  github.pull_request.opened:
  github.pull_request.synchronize:

agent:
  environment: base.linux
  resources:
    cpu: 2
    memory: 4
  provider: openai
  model: gpt-5.6-sol
  instructions: |
    Own this pull request review for its lifetime.

    Inspect the diff and relevant repository context. Report only actionable
    findings supported by the code.
```

Workflow files live under `.factory/workflows/`. Factory registers them only from the repository's default branch, so pull requests cannot change the instructions governing their own execution. The initial DSL is intentionally small; permissions, schedules, trigger filters, tools, and delegated agents will be added only when Factory enforces their semantics.

## Development

```bash
bun install
```
