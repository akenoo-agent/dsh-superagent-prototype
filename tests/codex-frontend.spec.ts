import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// The launcher is shipped as an executable JavaScript file.
// @ts-expect-error The standalone script is not part of the TypeScript build.
import { allowed, changed, snapshot } from '../scripts/codex-frontend.mjs'

describe('frontend delegation scope', () => {
  it('allows UI files while reserving API, server and contract files', () => {
    expect(allowed('frontend/web/src/app/page.tsx')).toBe(true)
    expect(allowed('frontend/web/src/components/ui/button.tsx')).toBe(true)
    expect(allowed('frontend/web/src/app/api/quote/route.ts')).toBe(false)
    expect(allowed('frontend/web/src/app/api/x.css')).toBe(false)
    expect(allowed('frontend/web/src/lib/server/proxy.ts')).toBe(false)
    expect(allowed('frontend/web/src/server/bff.ts')).toBe(false)
    expect(allowed('frontend/contract/openapi.json')).toBe(false)
  })
  it('reports only changes made since the snapshot, including a previously dirty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-delegation-'))
    try {
      execFileSync('git', ['init', '-q', dir])
      writeFileSync(join(dir, 'backend'), 'before')
      execFileSync('git', ['-C', dir, 'add', 'backend'])
      writeFileSync(join(dir, 'backend'), 'pre-existing')
      const before = snapshot(dir)
      writeFileSync(join(dir, 'new'), 'UI')
      expect(changed(before, snapshot(dir))).toEqual(['new'])
      writeFileSync(join(dir, 'backend'), 'modified again')
      expect(changed(before, snapshot(dir))).toEqual(['backend', 'new'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('delegation launcher', () => {
  it('runs Codex in the worktree, checks only new changes, and runs all frontend checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-delegate-run-'))
    const repo = join(dir, 'repo'), bin = join(dir, 'bin')
    try {
      // Set up a real Git checkout with pre-existing backend changes.
      mkdirSync(join(repo, 'frontend/web/src/app'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(repo, 'frontend/web/src/app/page.tsx'), 'old')
      writeFileSync(join(repo, 'backend'), 'initial')
      execFileSync('git', ['init', '-q', repo])
      execFileSync('git', ['-C', repo, 'add', '.'])
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'initial'])
      writeFileSync(join(repo, 'backend'), 'pre-existing backend change')
      writeFileSync(join(bin, 'codex'), `#!/bin/sh\nif [ "$1" = login ]; then echo 'Logged in using ChatGPT'; exit 0; fi\n[ "$OPENAI_API_KEY" = '' ] || exit 10\nprintf 'new' > frontend/web/src/app/page.tsx\n[ "$WRITE_API" = 1 ] && printf bad > backend\nexit 0\n`)
      writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(bin, 'codex'), 0o755); chmodSync(join(bin, 'npm'), 0o755)
      const output = execFileSync(process.execPath, [join(process.cwd(), 'scripts/codex-frontend.mjs'), repo], {
        input: 'Update the UI', encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPENAI_API_KEY: 'must-be-removed' },
      })
      expect(output).toContain('frontend/web/src/app/page.tsx')
      expect(output).toContain('npm run lint')
      expect(output).toContain('npm run typecheck')
      expect(output).toContain('npm test')
      expect(output).not.toContain('backend')
      expect(readFileSync(join(repo, 'backend'), 'utf8')).toBe('pre-existing backend change')
      const rejected = spawnSync(process.execPath, [join(process.cwd(), 'scripts/codex-frontend.mjs'), repo], {
        input: 'Update UI', encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, WRITE_API: '1' },
      })
      expect(rejected.status).toBe(1)
      expect(rejected.stdout).toContain('backend')
      expect(rejected.stdout).not.toContain('npm run lint')
      writeFileSync(join(repo, 'backend'), 'pre-existing backend change')
      writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 17\n')
      const checksFailed = spawnSync(process.execPath, [join(process.cwd(), 'scripts/codex-frontend.mjs'), repo], {
        input: 'Update UI', encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      })
      expect(checksFailed.status).toBe(1)
      expect(checksFailed.stdout).toContain('"exit":17')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
