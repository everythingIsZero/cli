/**
 * pwa.test.mjs — `hxym18 init pwa` 生成物 + `pwaCheckProblems` 三条判定
 * （CLI 只生成接入文件与校验，不 import pwa-kit、不重复策略逻辑）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { pwaScaffold, pwaDeclared, pwaCheckProblems, genScriptImportsPwaKit } from '../src/core.mjs'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))

/** 跑 check；返回 { code, out }（stdout+stderr 合并；非零不抛） */
function runCheck(dir, extra = []) {
  const r = spawnSync(process.execPath, [BIN, 'check', dir, ...extra], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

test('pwaScaffold：产出站点根相对路径 sw.config.mjs 与 scripts/gen-sw.mjs，后者 import @hxym18/pwa-kit/sw', () => {
  const files = pwaScaffold()
  const gen = files.find((f) => f.path === 'scripts/gen-sw.mjs')
  assert.ok(gen)
  assert.match(gen.content, /@hxym18\/pwa-kit\/sw/)
  assert.ok(files.some((f) => f.path === 'sw.config.mjs'))
})

test('pwaScaffold：sw.config/gen-sw 不兜 "dev"——空 VERSION 交由 buildSw 抛错（F5/S7）', () => {
  const byPath = Object.fromEntries(pwaScaffold().map((f) => [f.path, f.content]))
  assert.match(byPath['sw.config.mjs'], /version: process\.env\.SW_VERSION \|\| ''/)
  assert.doesNotMatch(byPath['sw.config.mjs'], /\|\| 'dev'/)
  assert.doesNotMatch(byPath['scripts/gen-sw.mjs'], /\|\| 'dev'/)
})

test('pwaScaffold：sw.config 默认读 SW_VERSION + 默认 /_next/static/ cache-first（DEF-1/2）', () => {
  const byPath = Object.fromEntries(pwaScaffold().map((f) => [f.path, f.content]))
  assert.match(byPath['sw.config.mjs'], /version: process\.env\.SW_VERSION/)
  assert.match(byPath['sw.config.mjs'], /match: '\/_next\/static\/'/)
  assert.match(byPath['sw.config.mjs'], /strategy: 'cache-first'/)
})

test('pwaScaffold：产出 Dockerfile.pwa-snippet 两段（SW_VERSION 校验 + 构建期 gen-sw；运行镜像 COPY public）TOOL-1/2/DEF-5', () => {
  const byPath = Object.fromEntries(pwaScaffold().map((f) => [f.path, f.content]))
  const snippet = byPath['Dockerfile.pwa-snippet']
  assert.ok(snippet, '须生成 Dockerfile 片段')
  // 段 1：SW_VERSION 非空校验 + 构建期跑 gen-sw
  assert.match(snippet, /test -n "\$SW_VERSION"/)
  assert.match(snippet, /node scripts\/gen-sw\.mjs/)
  // 段 2：运行镜像含 public/（含构建生成的 sw.js）
  assert.match(snippet, /COPY --from=builder[^\n]*public[^\n]*\.\/public/)
})


test('pwaCheckProblems：提交 sw.js / 缺 gen 脚本 → 报问题；干净 → 空', () => {
  assert.equal(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, genScriptImportsPwaKit: true, pinned: true }).length, 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: true, genScriptPresent: true, genScriptImportsPwaKit: true, pinned: true }).length > 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: false, pinned: true }).length > 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, genScriptImportsPwaKit: true, pinned: false }).length > 0)
})

test('pwaCheckProblems：gen 脚本存在但不 import @hxym18/pwa-kit/sw → 报问题（S7 判据）', () => {
  assert.ok(
    pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, genScriptImportsPwaKit: false, pinned: true }).length > 0,
  )
  assert.equal(
    pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, genScriptImportsPwaKit: true, pinned: true }).length,
    0,
  )
})

test('genScriptImportsPwaKit：import/require/动态 import 均认；不含则否', () => {
  assert.equal(genScriptImportsPwaKit("import { buildSw } from '@hxym18/pwa-kit/sw'"), true)
  assert.equal(genScriptImportsPwaKit('const { buildSw } = require("@hxym18/pwa-kit/sw")'), true)
  assert.equal(genScriptImportsPwaKit("await import('@hxym18/pwa-kit/sw')"), true)
  assert.equal(genScriptImportsPwaKit('self.addEventListener("install", () => { self.skipWaiting() })'), false)
  assert.equal(genScriptImportsPwaKit('@hxym18/pwa-kit'), false)
  assert.equal(genScriptImportsPwaKit(''), false)
  assert.equal(genScriptImportsPwaKit(null), false)
})

test('pwaDeclared：声明 pwa-kit（deps/devDeps 合并视图）即 true', () => {
  assert.equal(pwaDeclared({ '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.3.0' }), true)
  assert.equal(pwaDeclared({ '@hxym18/auth': 'github:everythingIsZero/auth#v0.3.3' }), false)
  assert.equal(pwaDeclared({}), false)
  assert.equal(pwaDeclared(null), false)
})

test('check：声明 pwa-kit 且提交了 public/sw.js（无 gen 脚本）→ 命中拷贝产物；advisory exit=0，--strict exit≠0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hxym18-pwa-'))
  try {
    execFileSync('git', ['-C', dir, 'init', '-q'])
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.3.0' } }),
    )
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/a.ts'), "import { buildSw } from '@hxym18/pwa-kit/sw'\nexport const x = buildSw\n")
    mkdirSync(join(dir, 'public'), { recursive: true })
    writeFileSync(join(dir, 'public/sw.js'), '// copied artifact\n')
    execFileSync('git', ['-C', dir, 'add', 'public/sw.js'])

    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, '默认 advisory 不硬卡存量站')
    assert.match(advisory.out, /PWA 接入问题/)
    assert.match(advisory.out, /提交了 public\/sw\.js/)
    assert.match(advisory.out, /缺少 scripts\/gen-sw\.mjs/)

    const strict = runCheck(dir, ['--strict'])
    assert.equal(strict.code, 1, '--strict 视为失败')
    assert.match(strict.out, /PWA 接入问题/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('check：声明并锁版 pwa-kit、gen 脚本存在但不 import 包 → 报「未 import」（advisory exit=0，--strict exit≠0）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hxym18-pwa-'))
  try {
    execFileSync('git', ['-C', dir, 'init', '-q'])
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ dependencies: { '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.3.0' } }),
    )
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/a.ts'), "import { buildSw } from '@hxym18/pwa-kit/sw'\nexport const x = buildSw\n")
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    // 自写死 SW：存在 gen 脚本但不 import 共享包 → S7 判据不满足
    writeFileSync(join(dir, 'scripts/gen-sw.mjs'), '// hand-rolled sw\nself.addEventListener("install", () => self.skipWaiting())\n')

    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, '默认 advisory 不硬卡存量站')
    assert.match(advisory.out, /PWA 接入问题/)
    assert.match(advisory.out, /未 import @hxym18\/pwa-kit\/sw/)
    assert.doesNotMatch(advisory.out, /缺少 scripts\/gen-sw\.mjs/)

    const strict = runCheck(dir, ['--strict'])
    assert.equal(strict.code, 1, '--strict 视为失败')
    assert.match(strict.out, /未 import @hxym18\/pwa-kit\/sw/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
