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

test('dbScaffold：生成 db.ts + migrations.ts（WAL/foreign_keys/user_version）', async () => {
  const { dbScaffold } = await import('../src/index.mjs')
  const files = dbScaffold({ dir: 'server/src' })
  assert.deepEqual(files.map((f) => f.path), ['server/src/db.ts', 'server/src/migrations.ts'])
  assert.match(files[0].content, /journal_mode = WAL/)
  assert.match(files[0].content, /foreign_keys = ON/)
  assert.match(files[1].content, /user_version/)
  assert.match(files[1].content, /MIGRATIONS/)
})

test('taroAuthScaffold：生成 Taro 接线文件（客户端 + Hono 服务端）', async () => {
  const { taroAuthScaffold } = await import('../src/index.mjs')
  const files = taroAuthScaffold({ srcDir: 'src' })
  assert.deepEqual(files.map((f) => f.path), ['src/lib/sso-login.ts', 'server/src/auth.ts'])
  const client = files[0].content
  assert.match(client, /createTaroLogin/)
  assert.match(client, /createTaroApi/)
  assert.match(client, /createWeappLogin/)
  assert.match(client, /@hxym18\/auth\/taro/)
  assert.match(client, /@hxym18\/env/)
  assert.match(client, /Taro\.request/)
  const server = files[1].content
  assert.match(server, /createHonoAuthRoutes/)
  assert.match(server, /@hxym18\/auth\/hono/)
  assert.match(server, /weappVerify/)
  assert.match(server, /resolveIdentity/)
  assert.doesNotMatch(server, /501/)
})

test('taroAuthScaffold：无 src 目录时客户端基目录为空（服务端路径固定）', async () => {
  const { taroAuthScaffold } = await import('../src/index.mjs')
  assert.deepEqual(taroAuthScaffold({ srcDir: '' }).map((f) => f.path), ['lib/sso-login.ts', 'server/src/auth.ts'])
})

test('depsForCheck：合并 dependencies + devDependencies + peerDependencies（devDeps 不再漏检）', async () => {
  const { depsForCheck, findPinProblems } = await import('../src/index.mjs')
  const merged = depsForCheck({
    dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.3.3' },
    devDependencies: { '@hxym18/pwa-kit': '^0.2.1' },
    peerDependencies: { '@hxym18/env': '0.1.1' },
  })
  assert.deepEqual(findPinProblems(merged), [
    { name: '@hxym18/pwa-kit', spec: '^0.2.1' },
    { name: '@hxym18/env', spec: '0.1.1' },
  ])
})
