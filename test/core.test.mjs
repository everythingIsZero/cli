/**
 * core.test.mjs — CLI 核心（node:test，零依赖纯函数）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KNOWN_PACKAGES, LEGACY_AUTH_PACKAGE, pinSpec, isTagPin, findPinProblems, findLegacyRefs } from '../src/index.mjs'

test('KNOWN_PACKAGES：共享包名映射', () => {
  assert.equal(KNOWN_PACKAGES.auth, '@hxym18/auth')
  assert.equal(KNOWN_PACKAGES.analytics, '@hxym18/analytics')
  assert.ok(Object.isFrozen(KNOWN_PACKAGES))
})

test('pinSpec：规范化 tag（补 v），产出 github 依赖串', () => {
  assert.equal(pinSpec('auth', '0.1.1'), 'github:everythingIsZero/auth#v0.1.1')
  assert.equal(pinSpec('auth', 'v0.1.1'), 'github:everythingIsZero/auth#v0.1.1')
  assert.equal(pinSpec('share-kit', 'v0.2.0'), 'github:everythingIsZero/share-kit#v0.2.0')
})

test('isTagPin：只认 github:everythingIsZero/<pkg>#v<semver>', () => {
  assert.equal(isTagPin('github:everythingIsZero/auth#v0.1.1'), true)
  assert.equal(isTagPin('github:everythingIsZero/share-kit#v0.2.0'), true)
  assert.equal(isTagPin('github:everythingIsZero/auth#main'), false)
  assert.equal(isTagPin('workspace:*'), false)
  assert.equal(isTagPin('^1.0.0'), false)
})

test('findPinProblems：@hxym18/* 依赖必须 tag 锁版，否则列出', () => {
  const deps = {
    '@hxym18/auth': 'github:everythingIsZero/auth#v0.1.1',
    '@hxym18/analytics': 'github:everythingIsZero/analytics#main',
    '@hxym18/pwa-kit': '^0.2.1',
    'next': '14.2.32',
  }
  assert.deepEqual(findPinProblems(deps), [
    { name: '@hxym18/analytics', spec: 'github:everythingIsZero/analytics#main' },
    { name: '@hxym18/pwa-kit', spec: '^0.2.1' },
  ])
  assert.deepEqual(findPinProblems({ next: '14.2.32' }), [])
})

test('findLegacyRefs：扫描旧包名残留（@app/auth）', () => {
  assert.deepEqual(findLegacyRefs("import { x } from '@app/auth'\nfoo"), [LEGACY_AUTH_PACKAGE])
  assert.deepEqual(findLegacyRefs("import { x } from '@hxym18/auth'"), [])
  assert.deepEqual(findLegacyRefs(''), [])
})
