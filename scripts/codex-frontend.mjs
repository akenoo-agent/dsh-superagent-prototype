#!/usr/bin/env node
// Explicit, procedural delegation for the Akenoo web UI. This is not an OS security boundary.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readlinkSync, accessSync, constants, realpathSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function allowed(path) {
  if (/^frontend\/web\/src\/(app\/api|server|lib\/server)(\/|$)/.test(path)) return false
  return /^(frontend\/web\/(src\/(app\/(?!api\/)|components\/|features\/|lib\/(?!server\/))|public\/|tests\/(components\/|unit\/)))/.test(path)
}
function run(program, args, cwd, input, env = process.env) {
  return spawnSync(program, args, { cwd, input, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}
function git(cwd, ...args) {
  const result = run('git', args, cwd)
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`)
  return result.stdout
}
export function snapshot(cwd) {
  const files = git(cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean)
  const result = new Map()
  for (const file of new Set(files)) {
    try {
      const full = join(cwd, file), stat = lstatSync(full)
      const contents = stat.isSymbolicLink() ? readlinkSync(full) : stat.isFile() ? readFileSync(full) : ''
      result.set(file, `${stat.mode}:${createHash('sha256').update(contents).digest('hex')}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return result
}
export function changed(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort()
}
function realCodex() {
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry || entry.endsWith('/worker-bin')) continue
    const candidate = join(entry, 'codex')
    try { accessSync(candidate, constants.X_OK); return realpathSync(candidate) } catch { /* try next directory */ }
  }
  throw new Error('Real Codex CLI not found outside worker-bin')
}
export function main() {
  const cwd = resolve(process.argv[2] ?? ''), task = readFileSync(0, 'utf8').trim()
  if (!task) throw new Error('Provide the frontend task on stdin')
  if (realpathSync(git(cwd, 'rev-parse', '--show-toplevel').trim()) !== realpathSync(cwd)) throw new Error('Pass the ticket worktree root')
  const codex = realCodex(), env = { ...process.env }
  delete env.OPENAI_API_KEY
  const login = run(codex, ['login', 'status'], cwd, undefined, env)
  if (login.error) throw new Error(`Codex login check could not start: ${login.error.message}`)
  if (login.status !== 0 || !`${login.stdout}\n${login.stderr}`.includes('Logged in using ChatGPT')) throw new Error('Codex ChatGPT login is required')
  const head = git(cwd, 'rev-parse', 'HEAD'), index = git(cwd, 'diff', '--cached', '--binary'), before = snapshot(cwd)
  const prompt = `Implement only this Akenoo web UI task: ${task}\nEdit only frontend/web/src/app (except api), src/components, src/features, src/lib (except server), frontend/web/public, and frontend/web/tests/components or tests/unit. Do not edit API routes, server, contracts, backend, configuration, git metadata or other files. Do not commit. Do not read or disclose credentials or auth files.`
  const result = run(codex, ['exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'workspace-write', '-C', cwd, '-'], cwd, prompt, env)
  if (result.error) throw new Error(`Codex could not complete: ${result.error.message}`)
  let files = changed(before, snapshot(cwd))
  const outside = files.filter(file => !allowed(file))
  const gitChanged = git(cwd, 'rev-parse', 'HEAD') !== head || git(cwd, 'diff', '--cached', '--binary') !== index
  console.log(JSON.stringify({ codexExit: result.status, changedFiles: files, outsideScope: outside, gitChanged }, null, 2))
  if (result.status !== 0 || outside.length || gitChanged) return 1
  const checks = [['npm', 'run', 'lint'], ['npm', 'run', 'typecheck'], ['npm', 'test']]
  let failed = false
  for (const [program, ...args] of checks) {
    const check = run(program, args, join(cwd, 'frontend/web'))
    console.log(JSON.stringify({ command: [program, ...args].join(' '), exit: check.status, ...(check.error ? { error: check.error.message } : {}) }))
    if (check.status !== 0) failed = true
  }
  files = changed(before, snapshot(cwd))
  const afterTestsOutside = files.filter(file => !allowed(file))
  const gitChangedAfterChecks = git(cwd, 'rev-parse', 'HEAD') !== head || git(cwd, 'diff', '--cached', '--binary') !== index
  console.log(JSON.stringify({ changedFilesAfterChecks: files, outsideScopeAfterChecks: afterTestsOutside, gitChangedAfterChecks }))
  return failed || afterTestsOutside.length || gitChangedAfterChecks ? 1 : 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
