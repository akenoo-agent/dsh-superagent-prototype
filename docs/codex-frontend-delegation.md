# Codex frontend delegation for Akenoo

This optional integration assigns Akenoo web UI work to Codex and leaves APIs, server code, contracts and all other work with DeepSeek. It is a procedural guardrail: the DSH worker has full OS access and can bypass it. The launcher checks changes after Codex runs, including files already dirty before it started; it does not revert changes or inspect ignored files. Review any reported out-of-scope changes before continuing. Do not treat a successful check as an OS security boundary.

The launcher uses the operator's existing ChatGPT login through the installed Codex CLI. It removes `OPENAI_API_KEY` from the child environment, uses an ephemeral session and does not print Codex output. Never copy or log the authentication file. The CLI and login must already be available to the DSH process. A failed authentication check stops delegation.

For this installation, add the following to the worker's team Scope instructions using the management panel. Replace the launcher path with the absolute path to the installed `scripts/codex-frontend.mjs`. The directory is the ticket's `DSH_SUPERAGENT_DIR` shown in its execution instructions; quote it as a shell argument. Write the task to a temporary file outside the worktree and pass it on standard input. Do not interpolate untrusted ticket text into shell code.

```text
For every Akenoo web UI task, delegate its UI portion with:
PATH=/opt/homebrew/opt/node@22/bin:$PATH node /absolute/path/to/dsh-superagent/scripts/codex-frontend.mjs '/absolute/ticket/worktree' < '/absolute/path/to/task-file'

Use the ticket directory shown in the execution instructions. Do not call codex directly or bypass blocked commands. DeepSeek handles API routes, server code, frontend/contract and all non-UI work. Do not ask Codex to modify those paths. The launcher returns changed files, out-of-scope changes and check exit statuses. Inspect its result; if it fails or reports outside-scope changes, report the actual failure and resolve it before delivery. Run any additional checks required by the ticket. Include changed files, commands and their outcomes in the PR and ticket report. Do not treat this guardrail as a security boundary.

Open every PR as a draft, leave it in draft, never merge and never enable auto-merge. Work only on explicit human requests. Preserve the ticket worktree and existing project instructions.
```

The permitted UI paths are defined by `allowed` in the launcher. API routes (`frontend/web/src/app/api`), the API client `frontend/web/src/lib/api.ts`, server directories and shared contracts are excluded. Odoo views and static assets are outside the launcher's current scope; DeepSeek handles them. The launcher runs `npm run lint`, `npm run typecheck` and `npm test` in `frontend/web`; install the project's locked dependencies in the ticket worktree with `npm ci` before delegating. It does not install packages. The frontend requires Node 22 as specified by its package.

Keep `codex` in `blockedCommands`, set `maxWorkers` to 1, retain the existing worktree prepare command and configure admission for explicit requests. DSH can temporarily use one extra worker slot for a person's follow-up even when `maxWorkers` is 1; see [Execution](003-execution.md). Leave the existing delivery instructions prohibiting merge and auto-merge in place. Do not modify the live settings or restart the service merely by applying this documentation.
