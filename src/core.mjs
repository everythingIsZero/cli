/**
 * core.mjs — 共享包接入 CLI 核心（零依赖纯函数）
 *
 * 目的：把「怎么引用共享包」从「看别的项目怎么接」变成一条命令与一处规范：
 * 统一 `github:everythingIsZero/<repo>#v<semver>` tag 锁版，禁止手写/漂移。
 */

/** 共享包短名 → 包名 */
export const KNOWN_PACKAGES = Object.freeze({
  auth: '@hxym18/auth',
  analytics: '@hxym18/analytics',
  env: '@hxym18/env',
  'share-kit': '@hxym18/share-kit',
  'pwa-kit': '@hxym18/pwa-kit',
})

/** 被 @hxym18/auth 取代的旧包名（check 扫描残留用） */
export const LEGACY_AUTH_PACKAGE = '@app/auth'

/**
 * 产出 tag 锁版依赖串（tag 无 v 前缀则补上）。
 * @param {string} repo 仓库短名（如 'auth'）
 * @param {string} tag 版本（'0.1.1' 或 'v0.1.1'）
 * @returns {string}
 */
export function pinSpec(repo, tag) {
  const t = String(tag == null ? '' : tag).trim()
  const v = /^v/i.test(t) ? t : `v${t}`
  return `github:everythingIsZero/${repo}#${v}`
}

const TAG_PIN_RE = /^github:everythingIsZero\/[a-z0-9-]+#v\d+\.\d+\.\d+$/

/** 是否为规范的 tag 锁版（分支名/范围版本/workspace 均不算） */
export function isTagPin(spec) {
  return typeof spec === 'string' && TAG_PIN_RE.test(spec)
}

/**
 * 找出未 tag 锁版的 @hxym18/* 依赖。
 * @param {Record<string,string>} deps
 * @returns {{ name: string, spec: string }[]}
 */
export function findPinProblems(deps) {
  const out = []
  const d = deps && typeof deps === 'object' ? deps : {}
  for (const [name, spec] of Object.entries(d)) {
    if (name.startsWith('@hxym18/') && !isTagPin(spec)) out.push({ name, spec })
  }
  return out
}

/** 扫描源码里的旧包名残留 */
export function findLegacyRefs(text) {
  const s = typeof text === 'string' ? text : ''
  return s.includes(LEGACY_AUTH_PACKAGE) ? [LEGACY_AUTH_PACKAGE] : []
}

/**
 * 与版本基线比对共享包版本（未引入的包不报）。
 * @param {Record<string,string>} deps 项目 dependencies
 * @param {{ packages?: Record<string,string> } | null} baseline
 * @returns {{ name: string, expected: string, actual: string }[]}
 */
export function checkBaseline(deps, baseline) {
  const b = baseline && typeof baseline === 'object' ? baseline : null
  if (!b || !b.packages || typeof b.packages !== 'object') return []
  const d = deps && typeof deps === 'object' ? deps : {}
  const out = []
  for (const [name, expected] of Object.entries(b.packages)) {
    const actual = d[name]
    if (actual === undefined) continue
    if (actual !== expected) out.push({ name, expected, actual })
  }
  return out
}

const AUTH_ROUTES_TS = `/**
 * auth 路由装配（由 \`hxym18 init auth\` 生成；请按本站实际补 resolveIdentity）。
 * 分工：统一层认人，本站用人——这里只声明「openid → 本站 uid」。
 */
import { createAuthRoutes } from '@hxym18/auth/next'
import { WECHAT_PROVIDER } from '@hxym18/auth'

export const routes = createAuthRoutes({
  // 密钥传函数：运行期注入的 env 在装配期读不到；缺配由工厂 fail-closed 返 503
  session: { secret: () => process.env.SESSION_SECRET || '' },
  anchor: 'identity',
  async resolveIdentity(openid, ctx) {
    // TODO: 用本站身份库锚定（provider=WECHAT_PROVIDER, provider_uid=openid）
    //   已锚定返回老用户，否则建号；头像昵称可用 ctx.nickname / ctx.avatar
    void WECHAT_PROVIDER
    void ctx
    void openid
    throw new Error('resolveIdentity 未实现：请在 lib/auth-routes.ts 补本站锚定')
  },
})
`

const AUTH_ACTION_ROUTE_TS = `/** /api/auth/<action> 通配（sso-verify | wx-qrcode | wx-poll | logout） */
import { routes } from '@/lib/auth-routes'

export const dynamic = 'force-dynamic'
export const GET = routes.dispatch
export const POST = routes.dispatch
`

const AUTH_CONFIG_ROUTE_TS = `/** 登录页能力探测（wxEnabled / devLogin） */
import { NextResponse } from 'next/server'
import { routes } from '@/lib/auth-routes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const devLogin = process.env.AUTH_DEV_LOGIN === '1' || process.env.AUTH_DEV_LOGIN === 'true'
  return NextResponse.json({ ok: true, wxEnabled: routes.wxConfigured(), devLogin })
}
`

/**
 * 生成 auth 接入文件（Next App Router）。
 * @param {{ srcDir?: string }} [opts] srcDir 为空串则视 app 在项目根（无 src/）
 * @returns {{ path: string, content: string }[]}
 */
export function authScaffold(opts) {
  const o = opts || {}
  const raw = typeof o.srcDir === 'string' ? o.srcDir : 'src'
  const base = raw.replace(/\/+$/, '')
  const p = (rest) => (base ? `${base}/${rest}` : rest)
  return [
    { path: p('lib/auth-routes.ts'), content: AUTH_ROUTES_TS },
    { path: p('app/api/auth/[action]/route.ts'), content: AUTH_ACTION_ROUTE_TS },
    { path: p('app/api/auth/config/route.ts'), content: AUTH_CONFIG_ROUTE_TS },
  ]
}
