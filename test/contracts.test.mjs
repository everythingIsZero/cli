/**
 * contracts.test.mjs — 契约副本生成器 + 包级 check（spec §5 / §7）
 *
 * 全部用**临时目录 fixture**（不碰其他包仓）：在 $TMPDIR/opencode 下造最小工作区，
 * 动态 import 只解析 fixture 源码常量，验证「值从代码读、哈希可复现、副本==L0、check 可失败」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  contractHash,
  buildContracts,
  planContracts,
  writeContracts,
  packageContractProblems,
  parseCoreEndpoints,
  parseAuthDispatch,
  responseKeysFromLiteral,
  spreadKeysFromLiteral,
} from '../src/index.mjs'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))
const WORKSPACE_L0 = fileURLToPath(new URL('../../../knowledge/integration/contracts/', import.meta.url))

// —— fixture 源码（值刻意与真实包不同，证生成器不硬编码） ——
const POLICY = `export const DEFAULT_STRATEGY = 'network-only'
export const SENSITIVE_PREFIXES = Object.freeze(['/x/', '/y/'])
export function cacheableResponse(meta) {
  if (!meta || meta.status !== 200) return false
  const cc = String(meta.cacheControl || '').toLowerCase()
  for (const part of cc.split(',')) {
    const t = part.trim()
    if (t === 'no-store' || t.startsWith('private')) return false
  }
  const vary = String(meta.vary || '').toLowerCase()
  for (const part of vary.split(',')) {
    const t = part.trim()
    if (t === 'cookie' || t === 'authorization' || t === '*') return false
  }
  return true
}
export function decideRequest(req) {
  if (req.method !== 'GET') return { bypass: true }
  if (!req.sameOrigin) return { bypass: true }
  if (req.mode === 'navigate') return { strategy: 'network-only' }
  return { strategy: 'network-only' }
}
`

const CLI_CORE = `export const CORE_AUTH_ENDPOINTS = Object.freeze([
  'config',
  'dev-login',
  'sso-verify',
  'wx-qrcode',
  'wx-poll',
  'weapp',
  'logout',
])
`

function authServer(actions) {
  const methods = { config: 'GET', 'dev-login': 'POST', 'sso-verify': 'POST', 'wx-qrcode': 'GET', 'wx-poll': 'GET', weapp: 'POST', logout: 'POST' }
  const lines = actions.map((a) => `      if (action === '${a}' && method === '${methods[a]}') return null`).join('\n')
  return `export function createAuthRoutes() {
  return {
    async dispatch(req) {
      const method = req.method.toUpperCase()
      const action = ''
${lines}
      return null
    },
  }
}
`
}

const AUTH_CORE = `export const SENSITIVE_PREFIXES = Object.freeze(['/x/', '/y/'])
export function loginCapsFromCapabilities(caps) {
  const c = caps || {}
  return { isWechatInApp: c.isWechatMobile === true, isMobileBrowser: c.isMobile === true }
}
`

const ANALYTICS_CORE = `export const DEFAULT_DENY_PREFIXES = Object.freeze(['/x/', '/y/'])
export const DEFAULT_DENY_QUERY_KEYS = Object.freeze(['token', 't', 'access_token'])
export const NOINDEX_ROBOTS = Object.freeze({ index: false, follow: false })
`

const ENV_CAPABILITY = `export function capabilities() {
  return Object.freeze({
    isWechat: false, isWechatMobile: false, isDesktopWechat: false, isMiniprogram: false,
    isDouyin: false, isPwa: false, isMobile: false, isDesktop: false, isSmallGame: false,
  })
}
`

const SHARE_URL = `export const SENSITIVE_QUERY_KEYS = Object.freeze(['token', 't', 'access_token'])
export const DEFAULT_PUBLIC_HOSTS = Object.freeze(['share.example.com'])
export const CARD_SHARE_HOSTS = Object.freeze(['share.example.com'])
`

const SSO_SERVICE = `export function send() {}
function createQr(confirm) {
  return {
    status: 200,
    body: {
      ok: true,
      scene,
      qrUrl: \`https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=\${encodeURIComponent(d.ticket)}\`,
      expiresIn: 300,
      pairCode, // PC 分支忽略此字段
      ...(confirm ? { confirm: true } : {}),
    },
  }
}
async function handleIntrospect() {
  if (!valid) return send(res, 200, { ok: true, openid: null })
  return send(res, 200, { ok: true, openid: r.openid })
}
async function handleProfile() {
  return send(res, 200, { ok: true, profile: profile || {} })
}
async function pollScene(scene) {
  const rec = null
  const { org, openid } = rec
  const result = { ok: true, status: 'ok', openid: openid ?? null }
  if (org && openid) {
    const profile = await readProfile(openid, org)
    if (profile && profile.nickname) result.nickname = profile.nickname
    if (profile && profile.avatar) result.avatar = profile.avatar
  }
  return result
}
`

const CONSUMERS = {
  auth: ['sensitive-prefixes', 'endpoints', 'capability-projection', 'facade', 'contracts'],
  analytics: ['sensitive-prefixes', 'analytics-policy', 'contracts'],
  'pwa-kit': ['sensitive-prefixes', 'cache-policy', 'contracts'],
  'share-kit': ['sensitive-prefixes', 'share-url-policy', 'capability-projection', 'contracts'],
  env: ['capability-projection', 'contracts'],
  cli: ['endpoints', 'contracts'],
}

const DIRS = {
  auth: 'Projects/auth',
  analytics: 'Projects/analytics',
  'pwa-kit': 'Projects/pwa-kit',
  'share-kit': 'Projects/share-kit',
  env: 'Projects/env',
  cli: 'Projects/cli',
}

function writeFile(dir, rel, content) {
  const full = join(dir, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

/** 造最小工作区（fixture） */
function makeWorkspace() {
  const base = join(tmpdir(), 'opencode')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'hxym18-contracts-'))
  writeFile(root, 'Projects/pwa-kit/src/sw/policy.mjs', POLICY)
  writeFile(root, 'Projects/cli/src/core.mjs', CLI_CORE)
  writeFile(root, 'Projects/auth/src/server.mjs', authServer(['config', 'dev-login', 'sso-verify', 'wx-qrcode', 'wx-poll', 'weapp', 'logout']))
  writeFile(root, 'Projects/auth/src/core.mjs', AUTH_CORE)
  writeFile(root, 'Projects/analytics/src/core.mjs', ANALYTICS_CORE)
  writeFile(root, 'Projects/env/src/capability.mjs', ENV_CAPABILITY)
  writeFile(root, 'Projects/share-kit/src/core/share-url.mjs', SHARE_URL)
  writeFile(root, 'Projects/sso-bridge/auth-service.mjs', SSO_SERVICE)
  for (const short of Object.keys(DIRS)) {
    writeFile(root, join(DIRS[short], 'package.json'), JSON.stringify({ name: `@hxym18/${short}`, version: '0.0.0' }, null, 2) + '\n')
  }
  return root
}

async function withWorkspace(fn) {
  const root = makeWorkspace()
  try {
    return await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runBin(args) {
  try {
    const out = execFileSync('node', [BIN, ...args], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

// —— 哈希口径 ——

test('contractHash：口径与 contracts/README.md 一致（复算已落地 L0 文件）', () => {
  const files = readdirSync(WORKSPACE_L0).filter((f) => f.endsWith('.json'))
  assert.ok(files.length >= 2, '至少应有两份已落地契约')
  for (const f of files) {
    const sha8 = contractHash(readFileSync(join(WORKSPACE_L0, f), 'utf8'))
    assert.ok(f.includes(`+${sha8}.`), `${f} 重算哈希 ${sha8} 应与文件名一致`)
  }
})

test('contractHash：与缩进/键序无关，改值换名', () => {
  const a = contractHash({ b: 1, a: [2, 3] })
  const b = contractHash('{\n  "a": [2, 3],\n  "b": 1\n}\n')
  assert.equal(a, b)
  assert.notEqual(a, contractHash({ b: 1, a: [2, 4] }))
})

// —— 源码解析小件 ——

test('parseCoreEndpoints / parseAuthDispatch：从源码取动作与方法', () => {
  assert.deepEqual(parseCoreEndpoints(CLI_CORE), ['config', 'dev-login', 'sso-verify', 'wx-qrcode', 'wx-poll', 'weapp', 'logout'])
  const d = parseAuthDispatch(authServer(['config', 'logout']))
  assert.deepEqual(d, [{ action: 'config', method: 'GET' }, { action: 'logout', method: 'POST' }])
})

test('responseKeysFromLiteral：简写/注释/展开/条件键', () => {
  const lit = `{
    ok: true,
    scene, // 简写 + 注释 PC 分支
    ...(confirm ? { confirm: true } : {}),
  }`
  assert.deepEqual(responseKeysFromLiteral(lit), ['ok', 'scene', 'confirm'])
  assert.deepEqual(spreadKeysFromLiteral(lit), ['confirm'])
})

// —— buildContracts ——

test('buildContracts：从 fixture 源码构造 8 份契约（值不手抄）', async () => {
  await withWorkspace(async (root) => {
    const { version, entries } = await buildContracts({ root })
    assert.equal(version, 1)
    assert.deepEqual(
      entries.map((e) => e.name),
      ['sensitive-prefixes', 'endpoints', 'cache-policy', 'share-url-policy', 'analytics-policy', 'capability-projection', 'facade', 'contracts'],
    )
    for (const e of entries) {
      assert.match(e.filename, new RegExp(`^${e.name.replace('.', '\\.')}@1\\+${e.sha8}\\.json$`))
      assert.equal(e.sha8, contractHash(e.value))
    }
    const by = Object.fromEntries(entries.map((e) => [e.name, e.value]))
    assert.deepEqual(by['sensitive-prefixes'].prefixes, ['/x/', '/y/'])
    assert.deepEqual(by.endpoints.endpoints.map((x) => x.action), ['config', 'dev-login', 'sso-verify', 'wx-qrcode', 'wx-poll', 'weapp', 'logout'])
    assert.equal(by.endpoints.endpoints[0].method, 'GET')
    assert.equal(by['cache-policy'].defaultStrategy, 'network-only')
    assert.equal(by['cache-policy'].navigationStrategy, 'network-only')
    assert.deepEqual(by['cache-policy'].sensitivePrefixes, ['/x/', '/y/'])
    assert.deepEqual(by['cache-policy'].cacheableResponse.statuses, [200])
    assert.deepEqual(by['cache-policy'].cacheableResponse.cacheControlExcludes, ['no-store', 'private'])
    assert.deepEqual(by['cache-policy'].cacheableResponse.varyExcludes, ['cookie', 'authorization', '*'])
    assert.equal(by['cache-policy'].publicCacheable, false)
    assert.equal(by['cache-policy'].offlineUrl, false)
    assert.deepEqual(by['share-url-policy'], { defaultPublicHosts: ['share.example.com'], sensitiveQueryKeys: ['token', 't', 'access_token'], cardShareHosts: ['share.example.com'] })
    assert.deepEqual(by['analytics-policy'].denyPrefixes, ['/x/', '/y/'])
    assert.deepEqual(by['analytics-policy'].noindex, { index: false, follow: false })
    assert.deepEqual(by['capability-projection'].capabilities, ['isWechat', 'isWechatMobile', 'isDesktopWechat', 'isMiniprogram', 'isDouyin', 'isPwa', 'isMobile', 'isDesktop', 'isSmallGame'])
    assert.deepEqual(by['capability-projection'].login, { isWechatInApp: 'isWechatMobile', isMobileBrowser: 'isMobile' })
    assert.deepEqual(by.facade.operations.introspect.responseKeys, ['ok', 'openid'])
    assert.deepEqual(by.facade.operations.profile.responseKeys, ['ok', 'profile'])
    assert.deepEqual(by.facade.operations['qr.issue'].responseKeys, ['ok', 'scene', 'qrUrl', 'expiresIn', 'pairCode', 'confirm'])
    assert.deepEqual(by.facade.operations['qr.poll'].responseKeys, ['ok', 'status', 'openid', 'nickname', 'avatar'])
    assert.deepEqual(by.facade.pending, ['unionid'])
    // 清单 = 其余 7 份的 ver+sha8
    const seven = Object.fromEntries(entries.filter((e) => e.name !== 'contracts').map((e) => [e.name, `1+${e.sha8}`]))
    assert.deepEqual(by.contracts.contracts, seven)
  })
})

test('buildContracts：端点不一致（core 与 dispatch）→ 抛错', async () => {
  await withWorkspace(async (root) => {
    writeFile(root, 'Projects/auth/src/server.mjs', authServer(['config', 'logout']))
    await assert.rejects(buildContracts({ root }), /端点不一致/)
  })
})

// —— 生成 / 幂等 ——

test('writeContracts：落 L0 + 副本 + 声明；副本逐字节 == L0；幂等', async () => {
  await withWorkspace(async (root) => {
    const l0Dir = join(root, 'knowledge/integration/contracts')
    const plan = await planContracts({ root, l0Dir })
    const first = await writeContracts({ root, l0Dir })
    assert.equal(first.l0Writes.length, 8)
    assert.equal(first.copyWrites.length, Object.values(CONSUMERS).flat().length)
    assert.equal(first.pkgEdits.length, Object.keys(DIRS).length)

    const l0Files = readdirSync(l0Dir).filter((f) => f.endsWith('.json'))
    assert.equal(l0Files.length, 8)
    // 副本 == L0（逐字节）且声明一一对应
    for (const [short, names] of Object.entries(CONSUMERS)) {
      const pkgDir = join(root, DIRS[short])
      const json = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
      assert.deepEqual(Object.keys(json.hxym18.contracts).sort(), [...names].sort(), `${short} 声明`)
      for (const name of names) {
        const entry = plan.entries.find((e) => e.name === name)
        const copyPath = join(pkgDir, 'contracts', entry.filename)
        assert.ok(existsSync(copyPath), `${short}/contracts/${entry.filename}`)
        assert.equal(readFileSync(copyPath, 'utf8'), readFileSync(join(l0Dir, entry.filename), 'utf8'))
      }
    }
    // 幂等：再写一次产物不变
    const before = l0Files.map((f) => readFileSync(join(l0Dir, f), 'utf8'))
    await writeContracts({ root, l0Dir })
    const after = readdirSync(l0Dir).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(l0Dir, f), 'utf8'))
    assert.deepEqual(after, before)
  })
})

// —— 包级 check ——

test('packageContractProblems：生成后通过；改坏副本/删副本/多副本/端点漂移 → 失败', async () => {
  await withWorkspace(async (root) => {
    const l0Dir = join(root, 'knowledge/integration/contracts')
    const plan = await writeContracts({ root, l0Dir })
    const authDir = join(root, DIRS.auth)

    assert.deepEqual(packageContractProblems({ pkgDir: authDir, l0Dir }), [])

    // ② 改坏副本内容（哈希不符 + 与 L0 不一致）
    const sensitive = plan.entries.find((e) => e.name === 'sensitive-prefixes')
    const copyPath = join(authDir, 'contracts', sensitive.filename)
    const orig = readFileSync(copyPath, 'utf8')
    writeFileSync(copyPath, orig.replace('/x/', '/zzz/'))
    let probs = packageContractProblems({ pkgDir: authDir, l0Dir })
    assert.ok(probs.some((p) => /哈希不符/.test(p)), probs.join('\n'))
    assert.ok(probs.some((p) => /与 L0 不一致/.test(p)), probs.join('\n'))
    writeFileSync(copyPath, orig)

    // ① 删副本
    const removed = copyPath + '.bak'
    writeFileSync(removed, orig)
    rmSync(copyPath)
    probs = packageContractProblems({ pkgDir: authDir, l0Dir })
    assert.ok(probs.some((p) => /缺少副本/.test(p)), probs.join('\n'))
    writeFileSync(copyPath, orig)
    rmSync(removed)

    // ① 多出未声明副本
    writeFileSync(join(authDir, 'contracts', 'rogue@1+deadbeef.json'), '{}')
    probs = packageContractProblems({ pkgDir: authDir, l0Dir })
    assert.ok(probs.some((p) => /多出未声明/.test(p)), probs.join('\n'))
    rmSync(join(authDir, 'contracts', 'rogue@1+deadbeef.json'))

    // ④ 端点漂移：auth 包内 server 少一个端点
    writeFileSync(join(authDir, 'src/server.mjs'), authServer(['config', 'logout']))
    probs = packageContractProblems({ pkgDir: authDir, l0Dir })
    assert.ok(probs.some((p) => /端点不完整/.test(p)), probs.join('\n'))
  })
})

test('packageContractProblems：未声明 → 失败（不得静默通过）', async () => {
  await withWorkspace(async (root) => {
    const probs = packageContractProblems({ pkgDir: join(root, DIRS.auth), l0Dir: null })
    assert.ok(probs.some((p) => /未声明 hxym18\.contracts/.test(p)))
  })
})

// —— CLI e2e ——

test('CLI gen contracts：dry-run 只打印；--write 落盘幂等', async () => {
  await withWorkspace(async (root) => {
    const dry = runBin(['gen', 'contracts', '--root', root])
    assert.equal(dry.code, 0, dry.out)
    assert.match(dry.out, /dry-run/)
    assert.match(dry.out, /sensitive-prefixes@1\+[0-9a-f]{8}\.json/)
    assert.ok(!existsSync(join(root, 'knowledge/integration/contracts')), 'dry-run 不得落盘')

    const w = runBin(['gen', 'contracts', '--root', root, '--write'])
    assert.equal(w.code, 0, w.out)
    assert.match(w.out, /已写入/)
    assert.ok(existsSync(join(root, 'knowledge/integration/contracts')))
  })
})

test('CLI check --contracts：通过 exit 0；改坏副本 exit 1', async () => {
  await withWorkspace(async (root) => {
    const l0Dir = join(root, 'knowledge/integration/contracts')
    runBin(['gen', 'contracts', '--root', root, '--write'])
    const authDir = join(root, DIRS.auth)

    const ok = runBin(['check', authDir, '--contracts', l0Dir])
    assert.equal(ok.code, 0, ok.out)
    assert.match(ok.out, /包级契约校验通过/)

    const copy = readdirSync(join(authDir, 'contracts')).find((f) => f.startsWith('facade@'))
    writeFileSync(join(authDir, 'contracts', copy), '{"tampered":true}\n')
    const bad = runBin(['check', authDir, '--contracts', l0Dir])
    assert.equal(bad.code, 1, bad.out)
    assert.match(bad.out, /包级契约校验失败/)
  })
})

test('CLI check：无 hxym18.contracts 的站点目录仍走既有站点级校验（行为不变）', async () => {
  await withWorkspace(async (root) => {
    const site = join(root, 'apps/site')
    writeFile(root, 'apps/site/package.json', JSON.stringify({ dependencies: { '@hxym18/env': 'github:everythingIsZero/env#v0.1.1' } }) + '\n')
    writeFile(root, 'apps/site/src/a.ts', "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n")
    const r = runBin(['check', site])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /接入检查通过/)
  })
})
