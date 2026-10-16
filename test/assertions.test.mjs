/**
 * assertions.test.mjs — T17b 兜底断言：纯函数 + `hxym18 check` 端到端反例。
 *
 * 约定：每条断言都有**反例 fixture**证明「改前不报（新断言）、改后报」——
 * 默认 advisory（exit=0 且打印 ⚠），`--strict` 才 exit≠0（不改既有默认行为）。
 * 纯函数单测直接调 index.mjs；端到端用 process.execPath 真跑 bin。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  baselineDirection,
  baselineDeviations,
  pwaBuildChainProblems,
  swHeaderProblems,
  gitignoreSwProblems,
  manifestProblems,
  resolveIdentityPlaceholderProblems,
  honoCatchAllOrderProblems,
  authEnvDriftProblems,
  ssoOriginHardcodeProblems,
  loginFlowRewriteProblems,
  analyticsProblems,
  handWrittenUaProblems,
  adoptionGapProblems,
  adoptionSigns,
  dbSkeletonProblems,
  opsStatsProblems,
} from '../src/index.mjs'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))

function runCheck(dir, extra = []) {
  const r = spawnSync(process.execPath, [BIN, 'check', dir, ...extra], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'hxym18-assert-'))
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
  } catch (e) {
    throw e
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// 干净 baseline：pwa 站该有的四件（构建链/头/gitignore/manifest+apple）
const CLEAN_PWA = {
  'package.json': JSON.stringify({ dependencies: { '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.5.0' } }),
  'src/a.ts': "import { buildSw } from '@hxym18/pwa-kit/sw'\nexport const x = buildSw\n",
  Dockerfile:
    'FROM node:22 AS builder\nRUN test -n "$SW_VERSION" || exit 1 \\\n && SW_VERSION=$SW_VERSION node scripts/gen-sw.mjs\n' +
    'FROM node:22\nCOPY --from=builder /app/public ./public\n',
  'next.config.mjs': "import { withPwaKit } from '@hxym18/pwa-kit/next'\nexport default withPwaKit({})\n",
  '.gitignore': 'node_modules/\npublic/sw.js\n',
  'src/app/manifest.ts': "export default function m() { return { id: '/', icons: [{ purpose: 'maskable' }] } }\n",
  'src/app/layout.tsx': "export const metadata = { icons: { apple: '/icons/icon-192.png' } }\nexport default function L() { return null }\n",
}

// ------------------------------------------------------------------ 纯函数单测

test('baselineDirection / baselineDeviations：判「站点落后 vs 基线陈旧」（TOOL-14）', () => {
  assert.equal(baselineDirection('github:everythingIsZero/a#v0.3.0', 'github:everythingIsZero/a#v0.2.0'), 'site-behind')
  assert.equal(baselineDirection('github:everythingIsZero/a#v0.3.0', 'github:everythingIsZero/a#v0.4.0'), 'baseline-stale')
  assert.equal(baselineDirection('github:everythingIsZero/a#v0.3.0', 'github:everythingIsZero/a#v0.3.0'), 'match')
  assert.equal(baselineDirection('^0.3.0', 'github:everythingIsZero/a#v0.2.0'), 'unknown')

  const baseline = { packages: { '@hxym18/a': 'github:everythingIsZero/a#v0.3.0' } }
  const devs = baselineDeviations({ '@hxym18/a': 'github:everythingIsZero/a#v0.4.0' }, baseline)
  assert.deepEqual(devs, [
    {
      name: '@hxym18/a',
      expected: 'github:everythingIsZero/a#v0.3.0',
      actual: 'github:everythingIsZero/a#v0.4.0',
      direction: 'baseline-stale',
    },
  ])
})

test('pwaBuildChainProblems：缺 gen-sw/守卫/COPY public 逐项报（TOOL-1/2）', () => {
  const bad = pwaBuildChainProblems({ dockerfiles: ['FROM node:22\nRUN next build\n'], buildScript: 'next build' })
  assert.ok(bad.some((p) => p.includes('TOOL-1') && p.includes('gen-sw')))
  assert.ok(bad.some((p) => p.includes('TOOL-1') && p.includes('SW_VERSION')))
  assert.ok(bad.some((p) => p.includes('TOOL-2') && p.includes('public')))
  // 正向：完整片段 → 无问题
  const good = pwaBuildChainProblems({
    dockerfiles: ['RUN test -n "$SW_VERSION" && SW_VERSION=$SW_VERSION node scripts/gen-sw.mjs\nCOPY --from=builder /app/public ./public'],
    buildScript: '',
  })
  assert.deepEqual(good, [])
  // 构建脚本里有 gen-sw（无 Dockerfile）→ 不算缺 gen-sw
  const viaScript = pwaBuildChainProblems({ dockerfiles: [], buildScript: 'node scripts/gen-sw.mjs && next build' })
  assert.deepEqual(viaScript, [])
})

test('swHeaderProblems：withPwaKit / 手写头 / Hono 中间件任一即过（TOOL-3）', () => {
  assert.equal(swHeaderProblems({ nextConfigs: ['export default {}'] }).length, 1)
  assert.deepEqual(swHeaderProblems({ nextConfigs: ["import { withPwaKit } from '@hxym18/pwa-kit/next'\nexport default withPwaKit({})"] }), [])
  assert.deepEqual(swHeaderProblems({ nextConfigs: ["headers: [{ source: '/sw.js', headers: [{ value: 'no-cache' }] }]"] }), [])
  assert.deepEqual(swHeaderProblems({ honoApps: ["app.use('/sw.js', async (c, next) => { c.res.headers.set('Cache-Control', 'no-cache') })"] }), [])
})

test('gitignoreSwProblems：认 public/sw.js 与 apps/<x>/public/sw.js（TOOL-5）', () => {
  assert.equal(gitignoreSwProblems({ gitignores: ['node_modules/\n'] }).length, 1)
  assert.deepEqual(gitignoreSwProblems({ gitignores: ['public/sw.js\n'] }), [])
  assert.deepEqual(gitignoreSwProblems({ gitignores: ['apps/wordinput/public/sw.js\n'] }), [])
})

test('manifestProblems：id / maskable / apple-touch-icon；buildManifest 兜默认（TOOL-4/B6）', () => {
  const bad = manifestProblems({ manifests: ['{"icons":[]}'], layouts: ['export default () => null'] })
  assert.ok(bad.some((p) => p.includes('id')))
  assert.ok(bad.some((p) => p.includes('maskable')))
  assert.ok(bad.some((p) => p.includes('apple-touch-icon')))
  const good = manifestProblems({
    manifests: ["export default () => ({ id: '/', icons: [{ purpose: 'maskable' }] })"],
    layouts: ["export const metadata = { icons: { apple: '/icons/icon-192.png' } }"],
  })
  assert.deepEqual(good, [])
  // buildManifest：id/maskable 由包默认兜底，不报
  const viaPkg = manifestProblems({
    manifests: ["import { buildManifest } from '@hxym18/pwa-kit/manifest'\nexport default () => buildManifest({})"],
    layouts: ['icons: { apple: [{}] }'],
  })
  assert.deepEqual(viaPkg, [])
})

test('manifestProblems：apple-touch-icon 只在注释里 → 不满足（改前假阴：注释行也当满足）', () => {
  const commentOnly = manifestProblems({
    manifests: ["export default () => ({ id: '/', icons: [{ purpose: 'maskable' }] })"],
    layouts: ['export default function L() { return null }\n// icons: { apple: "/icons/icon-192.png" }\n'],
  })
  assert.ok(commentOnly.some((p) => p.includes('apple-touch-icon')), commentOnly.join('\n'))
  // 块注释形态同样不算
  const blockComment = manifestProblems({
    manifests: ["export default () => ({ id: '/', icons: [{ purpose: 'maskable' }] })"],
    layouts: ['/* apple: "/icons/icon-192.png" */\nexport default function L() { return null }\n'],
  })
  assert.ok(blockComment.some((p) => p.includes('apple-touch-icon')), blockComment.join('\n'))
})

test('resolveIdentityPlaceholderProblems：占位即报（TOOL-6）', () => {
  assert.equal(resolveIdentityPlaceholderProblems([{ path: 'src/lib/auth-routes.ts', content: "throw new Error('resolveIdentity 未实现：补本站锚定')" }]).length, 1)
  assert.deepEqual(resolveIdentityPlaceholderProblems([{ path: 'x.ts', content: 'async resolveIdentity(openid, ctx) { return anchor(openid) }' }]), [])
})

test('honoCatchAllOrderProblems：站点端点注册在 catch-all 之后即报（TOOL-7）', () => {
  const bad = [
    {
      path: 'server/src/auth.ts',
      content:
        "authRoutes.all('/api/auth/*', (c) => routes.dispatch(c))\nauthRoutes.post('/api/auth/session', (c) => site(c))\n",
    },
  ]
  assert.equal(honoCatchAllOrderProblems(bad).length, 1)
  const good = [
    {
      path: 'server/src/auth.ts',
      content:
        "authRoutes.post('/api/auth/session', (c) => site(c))\nauthRoutes.all('/api/auth/*', (c) => routes.dispatch(c))\n",
    },
  ]
  assert.deepEqual(honoCatchAllOrderProblems(good), [])
})

test('authEnvDriftProblems：AUTH_INTERNAL_URL 非许可值即报（TOOL-8）', () => {
  assert.equal(authEnvDriftProblems([{ path: '.env.example', content: 'AUTH_INTERNAL_URL=http://auth-server:3000\n' }]).length, 1)
  assert.deepEqual(authEnvDriftProblems([{ path: '.env.example', content: 'AUTH_INTERNAL_URL=http://sso-unified-next:8100\n' }]), [])
  assert.deepEqual(authEnvDriftProblems([{ path: '.env.example', content: 'AUTH_INTERNAL_URL=https://auth.hxym18.com\n' }]), [])
})

test('ssoOriginHardcodeProblems：硬编码门面 origin 即报，注释不算（§4③/OPS-9）', () => {
  assert.equal(ssoOriginHardcodeProblems([{ path: 'src/login.ts', content: "const SSO_AUTH_BASE = 'https://auth.hxym18.com/'\n" }]).length, 1)
  assert.deepEqual(ssoOriginHardcodeProblems([{ path: 'src/login.ts', content: '// 门面 https://auth.hxym18.com/ 由 AUTH_ORIGIN 提供\n' }]), [])
})

test('loginFlowRewriteProblems：自写 consumeReturn / 轮询 即报（§4③）', () => {
  assert.equal(loginFlowRewriteProblems([{ path: 'src/login.ts', content: 'export function consumeReturn() {}\n' }]).length, 1)
  assert.equal(loginFlowRewriteProblems([{ path: 'src/poll.ts', content: "setInterval(() => fetch('/api/auth/wx-poll'), 1000)\n" }]).length, 1)
  assert.deepEqual(loginFlowRewriteProblems([{ path: 'src/login.ts', content: 'login.consumeReturn()\n' }]), [])
})

test('analyticsProblems：版本 < 修复版 / 硬编码 src 报（TOOL-9）', () => {
  const bad = analyticsProblems({
    deps: { '@hxym18/analytics': 'github:everythingIsZero/analytics#v0.2.0' },
    sources: [{ path: 'src/main.tsx', content: "const s = 'https://u.hxym18.com/script.js'\n" }],
  })
  assert.ok(bad.some((p) => p.includes('门控修复版')))
  assert.ok(bad.some((p) => p.includes('u.hxym18.com')))
  const good = analyticsProblems({
    deps: { '@hxym18/analytics': 'github:everythingIsZero/analytics#v0.3.0' },
    sources: [{ path: 'src/a.tsx', content: "import { DEFAULT_SCRIPT_SRC } from '@hxym18/analytics'\n" }],
  })
  assert.deepEqual(good, [])
})

test('handWrittenUaProblems：手写 UA 正则报；传 ua 给 capabilities 放行（TOOL-11）', () => {
  assert.equal(handWrittenUaProblems([{ path: 'a.tsx', content: 'const w = /MicroMessenger/i.test(navigator.userAgent)\n' }]).length, 1)
  assert.equal(handWrittenUaProblems([{ path: 'b.tsx', content: "const m = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)\n" }]).length, 1)
  assert.deepEqual(handWrittenUaProblems([{ path: 'c.tsx', content: "const caps = capabilities({ ua: navigator.userAgent, maxTouchPoints: 0 })\n" }]), [])
  assert.deepEqual(handWrittenUaProblems([{ path: 'd.tsx', content: '// 终端判定统一走 @hxym18/env，不手写 UA 正则\n' }]), [])
})

test('adoptionGapProblems / adoptionSigns：有面未接 → 报应接什么（TOOL-15）', () => {
  const sources = [
    { content: "const s='https://u.hxym18.com/script.js'\nconst w=/MicroMessenger/i.test(navigator.userAgent)\nfetch('/api/auth/config')\n" },
  ]
  const signs = adoptionSigns({ sources, manifests: ['{}'], layouts: ['manifest: "/manifest.webmanifest"'] })
  assert.equal(signs.loginSurface, true)
  assert.equal(signs.pwaSurface, true)
  assert.equal(signs.analyticsSurface, true)
  assert.equal(signs.uaSurface, true)
  const gaps = adoptionGapProblems({ declared: {}, signs })
  for (const pkg of ['@hxym18/auth', '@hxym18/pwa-kit', '@hxym18/analytics', '@hxym18/env']) {
    assert.ok(gaps.some((g) => g.includes(pkg)), `应提示接 ${pkg}`)
  }
  // 已声明则不提示
  assert.deepEqual(adoptionGapProblems({ declared: { '@hxym18/env': 'x', '@hxym18/auth': 'x', '@hxym18/pwa-kit': 'x', '@hxym18/analytics': 'x' }, signs }), [])
})

test('dbSkeletonProblems：db.ts 缺 WAL / 迁移调用点即报（TOOL-12）', () => {
  const bad = dbSkeletonProblems([{ path: 'server/src/db.ts', content: 'export const db = new Database()\n' }])
  assert.ok(bad.some((p) => p.includes('WAL')))
  assert.ok(bad.some((p) => p.includes('migrate')))
  assert.deepEqual(dbSkeletonProblems([{ path: 'server/src/db.ts', content: "db.pragma('journal_mode = WAL')\nmigrate(db)\n" }]), [])
})

test('dbSkeletonProblems：认内联 DDL + 幂等 ALTER / migrate 前缀 / PRAGMA user_version（TOOL-12 改前误报）', () => {
  // 既有站形态（fang）：内联 db.exec(DDL) + PRAGMA table_info 守卫 + 幂等 ALTER ADD COLUMN（无 migrate( 调用）
  const fangLike = dbSkeletonProblems([
    {
      path: 'apps/fang/src/lib/db.ts',
      content:
        "db.pragma(\"journal_mode = WAL\")\ndb.exec(DDL)\nconst cols = new Set((db.prepare(`PRAGMA table_info(contracts)`).all() as {name:string}[]).map(c=>c.name))\nif (!cols.has('map_lat')) db.exec(\"ALTER TABLE contracts ADD COLUMN map_lat REAL\")\n",
    },
  ])
  assert.deepEqual(fangLike, [])
  // 既有站形态（wordinput）：内联 DDL + 幂等 ALTER + migrate 前缀函数调用（migrateLegacyRows(db, adminId)）
  const wordinputLike = dbSkeletonProblems([
    {
      path: 'apps/wordinput/src/lib/db.ts',
      content:
        "db.pragma('journal_mode = WAL')\ndb.exec('ALTER TABLE templates RENAME TO templates_legacy')\nmigrateLegacyRows(db, adminId)\n",
    },
  ])
  assert.deepEqual(wordinputLike, [])
  // 版本化迁移：PRAGMA user_version
  assert.deepEqual(
    dbSkeletonProblems([{ path: 'server/src/db.ts', content: "db.pragma('journal_mode = WAL')\nconst v = db.pragma('user_version')\n" }]),
    [],
  )
  // 反例：有 WAL 但既无 migrate 前缀、也无 ALTER / user_version → 仍报迁移缺失（保判定力）
  const none = dbSkeletonProblems([
    { path: 'server/src/db.ts', content: "db.pragma('journal_mode = WAL')\nexport const db = new Database()\n" },
  ])
  assert.ok(none.some((p) => p.includes('migrate')), none.join('\n'))
})

test('opsStatsProblems：stats 出口缺 token/503/403/no-store 逐项报（TOOL-13）', () => {
  const bad = opsStatsProblems([{ path: 'src/app/api/ops/stats/route.ts', content: 'export const GET = () => 1\n' }])
  assert.equal(bad.length, 4)
  const good = opsStatsProblems([
    {
      path: 'src/app/api/ops/stats/route.ts',
      content:
        "process.env.OPS_STATS_TOKEN; req.headers.get('x-ops-token'); crypto.timingSafeEqual(a,b); 'Cache-Control': 'no-store'; status: 503; status: 403",
    },
  ])
  assert.deepEqual(good, [])
})

// ------------------------------------------------------------------ 端到端反例

test('check e2e：干净 PWA 站 → advisory 无 TOOL-1/2/3/4/5', () => {
  withProject(CLEAN_PWA, (dir) => {
    const r = runCheck(dir)
    assert.equal(r.code, 0, r.out)
    assert.doesNotMatch(r.out, /TOOL-[12345]/, r.out)
  })
})

test('check e2e 反例：PWA 站退化（无守卫/gen-sw/COPY/头/gitignore/manifest 字段）→ advisory exit0 且报；--strict exit1', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: { '@hxym18/pwa-kit': 'github:everythingIsZero/pwa-kit#v0.5.0' } }),
    'src/a.ts': "import { buildSw } from '@hxym18/pwa-kit/sw'\nexport const x = buildSw\n",
    Dockerfile: 'FROM node:22\nRUN next build\nCOPY . .\n',
    'next.config.mjs': 'export default {}\n',
    '.gitignore': 'node_modules/\n',
    'src/app/manifest.ts': 'export default function m() { return { name: "x" } }\n',
    'src/app/layout.tsx': 'export default function L() { return null }\n',
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    for (const tool of ['TOOL-1', 'TOOL-2', 'TOOL-3', 'TOOL-4', 'TOOL-5']) {
      assert.match(advisory.out, new RegExp(tool), `应报 ${tool}：\n${advisory.out}`)
    }
    assert.match(advisory.out, /站点接入断言/)
    const strict = runCheck(dir, ['--strict'])
    assert.equal(strict.code, 1, strict.out)
  })
})

test('check e2e 反例：resolveIdentity 占位 / auth env 陈旧 / 硬编码 SSO / 自写 consumeReturn（TOOL-6/8/§4③）', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: {} }),
    'src/lib/auth-routes.ts': "async resolveIdentity(o, ctx) { throw new Error('resolveIdentity 未实现：补本站锚定') }\n",
    '.env.example': 'AUTH_INTERNAL_URL=http://auth-server:3000\n',
    'src/lib/login.ts': "const SSO_AUTH_BASE = 'https://auth.hxym18.com/'\nexport function consumeReturn() {}\n",
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    assert.match(advisory.out, /TOOL-6/)
    assert.match(advisory.out, /TOOL-8/)
    assert.match(advisory.out, /SSO_AUTH_BASE 硬编码/)
    assert.match(advisory.out, /consumeReturn 自写/)
    const strict = runCheck(dir, ['--strict'])
    assert.equal(strict.code, 1, strict.out)
  })
})

test('check e2e 反例：Hono catch-all 在前 → TOOL-7（advisory exit0 / strict exit1）', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: {} }),
    'server/src/auth.ts':
      "authRoutes.all('/api/auth/*', (c) => routes.dispatch(c))\nauthRoutes.post('/api/auth/session', (c) => site(c))\n",
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    assert.match(advisory.out, /TOOL-7/)
    assert.equal(runCheck(dir, ['--strict']).code, 1)
  })
})

test('check e2e 反例：统计版本落后 + 硬编码 src → TOOL-9；UA 手写 → TOOL-11', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: { '@hxym18/analytics': 'github:everythingIsZero/analytics#v0.2.0' } }),
    'src/main.tsx':
      "import { shouldTrack } from '@hxym18/analytics'\nconst s = 'https://u.hxym18.com/script.js'\nconst w = /MicroMessenger/i.test(navigator.userAgent)\n",
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    assert.match(advisory.out, /TOOL-9/)
    assert.match(advisory.out, /TOOL-11/)
    assert.equal(runCheck(dir, ['--strict']).code, 1)
  })
})

test('check e2e 反例：未接站有面 → TOOL-15 提示应接什么', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: {} }),
    'public/manifest.webmanifest': '{"name":"x"}\n',
    'src/main.ts': "fetch('/api/auth/config')\nconst s='https://u.hxym18.com/script.js'\n",
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    assert.match(advisory.out, /TOOL-15/)
    assert.match(advisory.out, /@hxym18\/auth/)
    assert.match(advisory.out, /@hxym18\/analytics/)
    assert.equal(runCheck(dir, ['--strict']).code, 1)
  })
})

test('check e2e 反例：db 骨架缺项 + stats 出口裸奔 → TOOL-12/13', () => {
  const bad = {
    'package.json': JSON.stringify({ dependencies: {} }),
    'server/src/db.ts': 'export const db = 1\n',
    'src/app/api/ops/stats/route.ts': 'export const GET = () => 1\n',
  }
  withProject(bad, (dir) => {
    const advisory = runCheck(dir)
    assert.equal(advisory.code, 0, advisory.out)
    assert.match(advisory.out, /TOOL-12/)
    assert.match(advisory.out, /TOOL-13/)
    assert.equal(runCheck(dir, ['--strict']).code, 1)
  })
})

test('check e2e：干净站（无 @hxym18 依赖、无能力面）→ advisory 无站点断言；仍 exit 0', () => {
  withProject({ 'package.json': JSON.stringify({ dependencies: { next: '14.2.32' } }), 'src/a.ts': 'export const x = 1\n' }, (dir) => {
    const r = runCheck(dir)
    assert.equal(r.code, 0, r.out)
    assert.doesNotMatch(r.out, /TOOL-\d+/)
  })
})

test('check e2e：baseline 方向——站点落后 vs 基线陈旧（TOOL-14，advisory exit0 / strict exit1）', () => {
  const baseline = join(mkdtempSync(join(tmpdir(), 'hxym18-bl-')), 'baseline.json')
  writeFileSync(baseline, JSON.stringify({ packages: { '@hxym18/env': 'github:everythingIsZero/env#v0.1.2' } }))
  try {
    // 站点落后
    withProject(
      {
        'package.json': JSON.stringify({ dependencies: { '@hxym18/env': 'github:everythingIsZero/env#v0.1.1' } }),
        'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
      },
      (dir) => {
        const r = runCheck(dir, ['--baseline', baseline])
        assert.equal(r.code, 0, r.out)
        assert.match(r.out, /站点落后/)
      },
    )
    // 基线陈旧（站点已领先）
    withProject(
      {
        'package.json': JSON.stringify({ dependencies: { '@hxym18/env': 'github:everythingIsZero/env#v0.2.0' } }),
        'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
      },
      (dir) => {
        const r = runCheck(dir, ['--baseline', baseline, '--strict'])
        assert.equal(r.code, 1, r.out)
        assert.match(r.out, /基线陈旧/)
      },
    )
  } finally {
    rmSync(dirname(baseline), { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- P-4 误报修正

test('P-4 PWA TOOL-1：构建脚本（build:h5 等）调 gen-sw 即通过，不再只认 scripts.build', () => {
  assert.deepEqual(pwaBuildChainProblems({ dockerfiles: [], buildScript: 'node scripts/gen-sw.mjs && taro build --type h5' }), [])
  assert.deepEqual(pwaBuildChainProblems({ dockerfiles: [], buildScript: 'taro build --type h5 && node scripts/gen-sw.mjs' }), [])
  // 负例：完全没调 gen-sw → 仍报（不得放水）
  assert.equal(pwaBuildChainProblems({ dockerfiles: [], buildScript: 'vite build' }).length, 1)
})

test('P-4 PWA TOOL-5：git 判定已忽略即通过；git 不可用时回落文本扫描（仍可失败）', () => {
  assert.deepEqual(gitignoreSwProblems({ gitignores: [], ignoredByGit: true }), [])
  assert.equal(gitignoreSwProblems({ gitignores: [], ignoredByGit: false }).length, 1)
  assert.equal(gitignoreSwProblems({ gitignores: [], ignoredByGit: null }).length, 1, 'git 不可用 → 回落，缺即失败')
  assert.deepEqual(gitignoreSwProblems({ gitignores: ['public/sw.js'], ignoredByGit: null }), [])
  assert.equal(gitignoreSwProblems({ gitignores: [], ignoredByGit: undefined }).length, 1)
})

test('P-4 PWA TOOL-4/B6：站内已有 apple touch icon 文件即通过（iOS 自动请求 /apple-touch-icon.png）', () => {
  // manifest 本身合规（有 id + maskable），只验 apple 一项
  const m = ['{ "id": "/", "start_url": "/", "icons": [{ "src": "/m-192.png", "purpose": "maskable" }] }']
  assert.deepEqual(manifestProblems({ manifests: m, layouts: [], appleIconFiles: ['public/apple-touch-icon.png'] }), [])
  // 无图标文件且代码里也没声明 → 仍报（不得放水）
  assert.equal(manifestProblems({ manifests: m, layouts: [], appleIconFiles: [] }).length, 1)
})

test('P-4 PWA TOOL-1：构建链里调 gen-sw（无 .mjs 后缀）也算', () => {
  assert.deepEqual(pwaBuildChainProblems({ dockerfiles: [], buildScript: 'node scripts/gen-sw && vite build' }), [])
})

// ---------------------------------------------------------------- P-11 注释行不作 catch-all 锚点

test('P-11 TOOL-7：注释里的 catch-all 不得当锚点（否则误报其后/其前的站点端点）', () => {
  const content = [
    "import { Hono } from 'hono'",
    "// 旧写法（已废）：authRoutes.all('/api/auth/*', routes.dispatch)",
    "authRoutes.post('/api/auth/device', handler)   // 站点业务端点：注册在真 catch-all 之前",
    "authRoutes.all('/api/auth/*', routes.dispatch)",
    '',
  ].join('\n')
  assert.deepEqual(honoCatchAllOrderProblems([{ path: 'server/src/auth.ts', content }]), [])
})

test('P-11 TOOL-7：站点端点真注册在 catch-all 之后 → 仍报（不得放水）', () => {
  const content = [
    "authRoutes.all('/api/auth/*', routes.dispatch)",
    "authRoutes.post('/api/auth/device', handler)",
    '',
  ].join('\n')
  const problems = honoCatchAllOrderProblems([{ path: 'server/src/auth.ts', content }])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /\/api\/auth\/device/)
})
