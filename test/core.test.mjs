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

test('authScaffold：生成 auth 接入文件（含 src 基目录）', async () => {
  const { authScaffold } = await import('../src/index.mjs')
  const files = authScaffold({ srcDir: 'src' })
  const paths = files.map((f) => f.path)
  assert.deepEqual(paths, [
    'src/lib/auth-routes.ts',
    'src/app/api/auth/[action]/route.ts',
    'src/app/api/auth/config/route.ts',
  ])
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]))
  assert.match(byPath['src/lib/auth-routes.ts'], /createAuthRoutes/)
  assert.match(byPath['src/lib/auth-routes.ts'], /@hxym18\/auth\/next/)
  assert.match(byPath['src/app/api/auth/[action]/route.ts'], /routes\.dispatch/)
  assert.match(byPath['src/app/api/auth/config/route.ts'], /wxConfigured/)
})

test('authScaffold：无 src 目录时基目录为空', async () => {
  const { authScaffold } = await import('../src/index.mjs')
  const paths = authScaffold({ srcDir: '' }).map((f) => f.path)
  assert.ok(paths.includes('lib/auth-routes.ts'))
  assert.ok(paths.includes('app/api/auth/[action]/route.ts'))
})

test('checkBaseline：与基线的共享包版本不一致即列出（未引入的不报）', async () => {
  const { checkBaseline } = await import('../src/index.mjs')
  const baseline = {
    packages: {
      '@hxym18/auth': 'github:everythingIsZero/auth#v0.1.2',
      '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.2.1',
      '@hxym18/analytics': 'github:everythingIsZero/analytics#v0.1.0',
    },
  }
  const deps = {
    '@hxym18/auth': 'github:everythingIsZero/auth#v0.1.1',
    '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.2.1',
    next: '14.2.32',
  }
  assert.deepEqual(checkBaseline(deps, baseline), [
    { name: '@hxym18/auth', expected: 'github:everythingIsZero/auth#v0.1.2', actual: 'github:everythingIsZero/auth#v0.1.1' },
  ])
})

test('checkBaseline：空/缺基线返回空', async () => {
  const { checkBaseline } = await import('../src/index.mjs')
  assert.deepEqual(checkBaseline({ '@hxym18/auth': 'x' }, null), [])
  assert.deepEqual(checkBaseline({}, { packages: {} }), [])
})
