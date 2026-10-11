/**
 * pwa.test.mjs — `hxym18 init pwa` 生成物 + `pwaCheckProblems` 三条判定
 * （CLI 只生成接入文件与校验，不 import pwa-kit、不重复策略逻辑）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pwaScaffold, pwaCheckProblems } from '../src/core.mjs'

test('pwaScaffold：产出站点根相对路径 sw.config.mjs 与 scripts/gen-sw.mjs，后者 import @hxym18/pwa-kit/sw', () => {
  const files = pwaScaffold()
  const gen = files.find((f) => f.path === 'scripts/gen-sw.mjs')
  assert.ok(gen)
  assert.match(gen.content, /@hxym18\/pwa-kit\/sw/)
  assert.ok(files.some((f) => f.path === 'sw.config.mjs'))
})

test('pwaCheckProblems：提交 sw.js / 缺 gen 脚本 → 报问题；干净 → 空', () => {
  assert.equal(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, pinned: true }).length, 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: true, genScriptPresent: true, pinned: true }).length > 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: false, pinned: true }).length > 0)
  assert.ok(pwaCheckProblems({ hasCommittedSw: false, genScriptPresent: true, pinned: false }).length > 0)
})
