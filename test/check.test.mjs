/**
 * check.test.mjs — `hxym18 check` 端到端（真跑 bin，覆盖门禁可失败）
 * 造临时工程 → 跑 check → 断言 exit 码与输出。门禁必须能失败，故这些断言是硬门。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))

/** 跑 check；返回 { code, out }（非零不抛） */
function runCheck(dir) {
  try {
    const out = execFileSync('node', [BIN, 'check', dir], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

/** 造临时工程（files: 相对路径 → 内容） */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'hxym18-check-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

function withProject(files, fn) {
  const dir = project(files)
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PINNED_ENV = 'github:everythingIsZero/env#v0.1.1'

test('check：声明了 @hxym18/env 却未 import → exit≠0（死依赖）', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': PINNED_ENV } }),
      'src/a.ts': 'export const x = 1\n',
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 1, '死依赖必须能失败')
      assert.match(r.out, /未 import.*死依赖|声明了但未 import/s)
      assert.match(r.out, /@hxym18\/env/)
    },
  )
})

test('check：声明且 import → exit 0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': PINNED_ENV } }),
      'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})

test('check：未 tag 锁版 → exit≠0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': '^0.1.0' } }),
      'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 1)
      assert.match(r.out, /未 tag 锁版/)
    },
  )
})

test('check：无问题 → exit 0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.6.1' } }),
      'src/a.ts': "import { isTicket } from '@hxym18/auth/core'\nexport const x = isTicket\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})
