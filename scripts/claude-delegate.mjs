#!/usr/bin/env node
// Explicit delegation; this is a procedural guardrail, not an OS security boundary.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, readFileSync, realpathSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshot, changed } from './codex-frontend.mjs'

function run(program, args, cwd, input, env = process.env) {
  return spawnSync(program, args, { cwd, input, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}
function git(cwd, ...args) {
  const result = run('git', args, cwd)
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`)
  return result.stdout
}
function executable() {
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry || entry.endsWith('/worker-bin')) continue
    const path = join(entry, 'claude')
    try { accessSync(path, constants.X_OK); return realpathSync(path) } catch { /* try next */ }
  }
  throw new Error('Claude Code CLI not found outside worker-bin')
}
export function main() {
  const cwd = resolve(process.argv[2] ?? ''), task = readFileSync(0, 'utf8').trim()
  if (!task) throw new Error('Provide the task on stdin')
  if (realpathSync(git(cwd, 'rev-parse', '--show-toplevel').trim()) !== realpathSync(cwd)) throw new Error('Pass the ticket worktree root')
  const claude = executable(), env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  const login = run(claude, ['auth', 'status'], cwd, undefined, env)
  let status
  try { status = JSON.parse(login.stdout) } catch { throw new Error('Claude Code authentication status unavailable') }
  if (login.status !== 0 || status.loggedIn !== true || status.authMethod !== 'claude.ai') throw new Error('Claude Code subscription login required')
  const head = git(cwd, 'rev-parse', 'HEAD'), index = git(cwd, 'diff', '--cached', '--binary'), before = snapshot(cwd)
  const prompt = `Work only on this delegated task within the current ticket worktree: ${task}\nDo not commit, push, merge, change git metadata, read or disclose credentials or auth files. Follow repository instructions. Stop if work exceeds the delegated task.`
  const result = run(claude, ['-p', '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--no-session-persistence'], cwd, prompt, env)
  const files = changed(before, snapshot(cwd)), gitChanged = git(cwd, 'rev-parse', 'HEAD') !== head || git(cwd, 'diff', '--cached', '--binary') !== index
  console.log(JSON.stringify({ claudeExit: result.status, ...(result.error ? { error: result.error.message } : {}), changedFiles: files, gitChanged }, null, 2))
  return result.error || result.status !== 0 || gitChanged ? 1 : 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
