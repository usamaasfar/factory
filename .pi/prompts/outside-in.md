---
description: Build from real usage with outside-in, test-driven development
argument-hint: "[task]"
---
Use outside-in, test-driven development for this task:

${@:-Use the task described in this conversation.}

Let real usage drive the API, not assumptions drive the implementation.

## Workflow

1. **Understand the consumer.** Inspect the relevant code, installed dependency contracts, and documentation. Identify who calls this component, how they call it, and what observable result they need. Investigate only what is necessary for the next step.
2. **Show the intended usage.** Start with a small, concrete example from the caller's perspective. State the narrow scope. If the API or scope is not already agreed, confirm it before implementation. Ask about consequential unknowns rather than silently inventing requirements.
3. **Write the test first.** Turn that usage into the smallest executable test through the actual consumer interface. Prefer real dependencies and the real runtime for the boundary being tested. Mock unrelated services or model responses when necessary, not the component whose behavior we need to verify.
4. **Run it and observe the failure.** Confirm that it fails for the missing behavior. A broken fixture, unavailable dependency, or incorrect test setup is not evidence of an implementation defect. Explain blockers rather than replacing the real path with a hidden fallback.
5. **Implement the smallest correct change.** Make the tested behavior work with idiomatic code and proper types. Do not add speculative abstractions, competing APIs, compatibility layers, or unrelated features. Do not hide contract mismatches with casts.
6. **Refactor while green.** Simplify names, control flow, and responsibilities without changing the agreed behavior. Rerun the test after changes. Do not weaken assertions merely to get a pass; correct an expectation only when the actual contract justifies it, and explain why.
7. **Repeat for the next real requirement.** Add meaningful failure and edge cases at the same boundary as needed. Keep each step small and grounded in observed behavior, not imagined future requirements.

## Working style

- Give concise progress updates: what you are testing, what failed, and what you are changing.
- Preserve unrelated work and keep the test files for review unless asked to remove them.
- Run the relevant type, lint, and format checks after the behavior works.
- Finish with changed files, exact verification commands and results, remaining limitations, and anything not verified. Distinguish real runtime verification from mocks and static checks. Stop when the agreed scope is complete and ready for review.
