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

/**
 * 汇总用于 check 的依赖视图：dependencies + devDependencies + peerDependencies。
 * 为什么合并：共享包放 devDependencies/peerDependencies 也须 tag 锁版，
 * 旧版只扫 dependencies 会漏（放 devDeps 的未锁版能逃过门禁）。
 * @param {any} json package.json 解析结果
 * @returns {Record<string,string>}
 */
export function depsForCheck(json) {
  const j = json && typeof json === 'object' ? json : {}
  return {
    ...(j.dependencies || {}),
    ...(j.devDependencies || {}),
    ...(j.peerDependencies || {}),
  }
}

/**
 * 找出「声明了可导入的 `@hxym18/*` 却未在代码出现」的包（死依赖）。
 * 只判可导入的包（`KNOWN_PACKAGES`；`@hxym18/cli` 是工具，不在其中）。
 * @param {string[]} declared 声明的包名
 * @param {Iterable<string>} present 代码里出现的包名
 * @returns {string[]}
 */
export function unusedShared(declared, present) {
  const has = new Set(present || [])
  const importable = new Set(Object.values(KNOWN_PACKAGES))
  return (Array.isArray(declared) ? declared : []).filter((n) => importable.has(n) && !has.has(n))
}

/** 扫描源码里的旧包名残留 */
export function findLegacyRefs(text) {
  const s = typeof text === 'string' ? text : ''
  return s.includes(LEGACY_AUTH_PACKAGE) ? [LEGACY_AUTH_PACKAGE] : []
}

/**
 * `@hxym18/auth` 共享核心端点（站点**不得自写**——由 core 单源提供，经挂载 + `resolveIdentity` 接入）。
 * 站点自有业务端点（如 `me`/`session`/`device`）不在其中，不算漂移。
 */
export const CORE_AUTH_ENDPOINTS = Object.freeze([
  'config',
  'dev-login',
  'sso-verify',
  'wx-qrcode',
  'wx-poll',
  'weapp',
  'logout',
])

// Next 路由文件：`**/api/auth/<core>/route.{ts,js,tsx,jsx,mjs}`
const NEXT_ROUTE_RE = /\/api\/auth\/([^/\s'"`?]+)\/route\.(?:ts|js|tsx|jsx|mjs)$/
// 路由定义行：`.get|.post|.put|.delete|.all|.use|.route(` 后紧跟引号内的 `/api/auth/<core>`（Hono/Express）
const ROUTE_DEF_RE = /\.(?:get|post|put|delete|all|use|route)\(\s*['"`]\/api\/auth\/([^/\s'"`?]+)/
// 行首注释（`//` / `/*` / `*`）
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*)/
// 测试文件路径（排除）
const TEST_PATH_RE = /(?:\/tests?\/|\.test\.|\.spec\.)/
// `grep -rn` 输出行：`path:lineno:content`
const GREP_LINE_RE = /^([^:]+):(\d+):([\s\S]*)$/

/**
 * 找出站点源码中**自写的 core 端点**（只认路由定义，不认字样提及）。
 * 判定：
 *   1. Next 路由文件路径 `**\/api/auth/<core>/route.{ts,js,tsx,jsx,mjs}`；或
 *   2. 路由定义行 `.get|.post|.put|.delete|.all|.use|.route(` 紧跟引号内 `/api/auth/<core>`。
 * 排除：行首注释（`//`、`/*`、`*`）、测试文件（`/test(s)/`、`.test.`、`.spec.`）；
 * 业务端点（`me`/`session`/`device`）与 `[action]` 通配不在白名单。
 * @param {string[]} files 待扫串（文件路径或 `grep -rn` 输出行 `path:lineno:content`）
 * @returns {string[]} 命中的原始串（按输入顺序）
 */
export function selfWrittenCoreEndpoints(files) {
  const list = Array.isArray(files) ? files : []
  const core = new Set(CORE_AUTH_ENDPOINTS)
  const hits = []
  for (const f of list) {
    const s = typeof f === 'string' ? f : ''
    if (!s) continue
    const gm = GREP_LINE_RE.exec(s)
    const path = gm ? gm[1] : s
    const content = gm ? gm[3] : s
    if (TEST_PATH_RE.test(path)) continue
    // 1. Next 路由文件（路径即定义，内容无关）
    const fileMatch = NEXT_ROUTE_RE.exec(path)
    if (fileMatch && core.has(fileMatch[1])) {
      hits.push(s)
      continue
    }
    // 2. 路由定义行（排除注释行）
    if (COMMENT_LINE_RE.test(content)) continue
    const defMatch = ROUTE_DEF_RE.exec(content)
    if (defMatch && core.has(defMatch[1])) hits.push(s)
  }
  return hits
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

const AUTH_ACTION_ROUTE_TS = `/** /api/auth/<action> 通配（sso-verify | wx-qrcode | wx-poll | weapp | logout | config | dev-login，全部单源） */
import { routes } from '@/lib/auth-routes'

export const dynamic = 'force-dynamic'
export const GET = routes.dispatch
export const POST = routes.dispatch
`

/**
 * 生成 auth 接入文件（Next App Router）。
 * 只生成「挂载 + resolveIdentity」：`[action]` 通配把 /api/auth/* 全量交给共享核心，
 * 不再产出单独的 config 路由（端点单源，避免自写端点漂移；pitfalls I14）。
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
  ]
}

const TARO_SSO_LOGIN_TS = `/**
 * sso-login.ts — Taro 统一登录接线（由 \`hxym18 init auth --target taro\` 生成）。
 * 分工：H5 走共享控制器（createTaroLogin + createTaroApi）；
 *       小程序(weapp/tt) 登录走各自身份源（Taro.login），本文件不介入。
 */
import Taro from '@tarojs/taro'
import { capabilities } from '@hxym18/env'
import { loginCapsFromCapabilities } from '@hxym18/auth/core'
import { createTaroLogin, createTaroApi, createWeappLogin } from '@hxym18/auth/taro'

const nav = typeof navigator !== 'undefined' ? navigator : undefined

export const login = createTaroLogin({
  // 终端由「有无 window」判定，无需手传 isH5
  // 能力位单一来源 @hxym18/env，经 loginCapsFromCapabilities 投影（勿整体透传 capabilities()）
  caps: loginCapsFromCapabilities(
    capabilities({
      ua: (nav && nav.userAgent) || '',
      maxTouchPoints: (nav && nav.maxTouchPoints) || 0,
    }),
  ),
  // 小程序无标准 fetch：注入 Taro.request，不必手写 config/qrcode/poll/verify/devLogin
  api: createTaroApi({
    request: (opts) => Taro.request(opts as any),
  }),
})

/** 挂载即调用：消费 ?sso=return 回跳（微信内静默登录） */
export function consumeSsoReturn() {
  return login.consumeReturn()
}

/** 微信内置浏览器：跳门面静默授权（回跳带 sso=return） */
export function startSso() {
  login.startSso()
}

export function getLoginState() {
  return login.getState()
}

/**
 * 小程序登录（weapp/tt）：Taro.login 取 code → 站点 /api/auth/weapp（共享核心换码+锚定）→ 存 token。
 * 通道故障不清已有 token（血泪：瞬时失败清 token 会让设备身份漂移）。
 */
export const weappLogin = createWeappLogin({
  Taro,
  request: (code) => Taro.request({ url: '/api/auth/weapp', method: 'POST', data: { code } }).then((r) => r.data),
  store: { set: (t) => Taro.setStorageSync('token', t) },
})
`

const TARO_SERVER_AUTH_TS = `/**
 * auth.ts — Hono 服务端 auth 装配（由 \`hxym18 init auth --target taro\` 生成）。
 * 分工：统一层认人，本站用人——你只需补 resolveIdentity（openid/unionid → 本站 user）。
 * 挂载：**先**注册站点自有 /api/auth/* 端点，**最后** \`app.route('/', authRoutes)\`（catch-all 末位）。
 */
import { Hono } from 'hono'
import { createHonoAuthRoutes } from '@hxym18/auth/hono'

export const authRoutes = new Hono()

const routes = createHonoAuthRoutes({
  // 密钥传函数：运行期注入的 env 在装配期读不到；缺配由工厂 fail-closed 返 503
  session: { secret: () => process.env.SESSION_SECRET || '' },
  anchor: 'identity',
  async resolveIdentity(openid, ctx) {
    // TODO: 用本站身份库锚定。锚键建议 ctx.unionid ?? openid（绑定同一微信开放平台后 unionid 跨端统一）
    //   已锚定返回老用户，否则建号；头像昵称可用 ctx.nickname / ctx.avatar
    void ctx
    void openid
    throw new Error('resolveIdentity 未实现：请在 server/src/auth.ts 补本站锚定')
  },
})

// 共享核心端点（sso-verify | wx-qrcode | wx-poll | weapp | logout | config | dev-login）单源分发——
// 逐条枚举会与核心漂移（端点单源破裂，pitfalls I14），故只留这一个通配。
// **catch-all 末位**：站点自有 /api/auth/*（如 session/device）必须在本文件之前注册，
// 否则被本 catch-all 吞掉（pitfalls I15）。挂载示例：
//   app.post('/api/auth/session', ...)   // 站点端点先注册
//   app.route('/', authRoutes)           // 共享 auth 最后挂
authRoutes.all('/api/auth/*', (c) => routes.dispatch(c))
`

/**
 * 生成 Taro 接入文件：客户端接线 + Hono 服务端装配（H5 与 Next 对等；小程序端登录站点自备）。
 * @param {{ srcDir?: string }} [opts] srcDir 为空串则视客户端源码在项目根（无 src/）
 * @returns {{ path: string, content: string }[]}
 */
export function taroAuthScaffold(opts) {
  const o = opts || {}
  const raw = typeof o.srcDir === 'string' ? o.srcDir : 'src'
  const base = raw.replace(/\/+$/, '')
  const p = (rest) => (base ? `${base}/${rest}` : rest)
  return [
    { path: p('lib/sso-login.ts'), content: TARO_SSO_LOGIN_TS },
    { path: 'server/src/auth.ts', content: TARO_SERVER_AUTH_TS },
  ]
}

const DB_TS = `/**
 * db.ts — SQLite 连接单例（WAL + foreign_keys；**本文件禁 DDL**，迁移见 migrations.ts）
 * 由 \`hxym18 init db\` 生成；基准参考 hmd2 / nuantie 的 db.ts。
 */
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const file = process.env.DB_FILE || './data/app.db'
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}
`

const MIGRATIONS_TS = `/**
 * migrations.ts — 版本化迁移（PRAGMA user_version 递增；db.ts 禁 DDL）
 * 由 \`hxym18 init db\` 生成。规则：只追加新迁移，不改历史项；可重入、版本递增。
 */
import type Database from 'better-sqlite3'
import { getDb } from './db'

const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1 —— 示例表，按需替换
  (db) => {
    db.exec(\`
      CREATE TABLE IF NOT EXISTS example (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    \`)
  },
]

export function migrate(): void {
  const db = getDb()
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    MIGRATIONS[v](db)
    db.pragma(\`user_version = \${v + 1}\`)
  }
}
`

/**
 * 生成后端数据层骨架（Hono + better-sqlite3 + 版本化迁移 = 规范默认后端）。
 * @param {{ dir?: string }} [opts] 目标目录（如 'server/src'）
 * @returns {{ path: string, content: string }[]}
 */
export function dbScaffold(opts) {
  const o = opts || {}
  const base = (typeof o.dir === 'string' ? o.dir : 'server/src').replace(/\/+$/, '')
  const p = (name) => (base ? `${base}/${name}` : name)
  return [
    { path: p('db.ts'), content: DB_TS },
    { path: p('migrations.ts'), content: MIGRATIONS_TS },
  ]
}

const SW_CONFIG_MJS = `/**
 * sw.config.mjs — Service Worker 生成配置（由 \`hxym18 init pwa\` 生成）。
 * version 取构建期 SW_VERSION；**空即由 buildSw 抛错**（不兜默认，部署边界用 \`test -n "$SW_VERSION"\` 拦）。
 * SW 默认不缓存，仅命中 rules 的路径按策略处理。
 * 策略语义由 @hxym18/pwa-kit/sw 定义——本文件只给规则，不重复策略逻辑。
 */
export default {
  version: process.env.SW_VERSION || '',
  rules: [{ match: '/_next/static/', strategy: 'cache-first' }],
}
`

const GEN_SW_MJS = `/**
 * gen-sw.mjs — 构建期从 @hxym18/pwa-kit/sw 生成 public/sw.js（由 \`hxym18 init pwa\` 生成）。
 *
 * 为什么生成而非手抄：安全修复走 minor 发版，站点升级依赖即可送达；sw.js 是构建产出，
 * **不提交**（.gitignore），因此不存在「已提交副本」漂移。
 * version 取自 SW_VERSION / sw.config.mjs；**空即由 buildSw 抛错**（不兜 'dev'）。
 * 用法：node scripts/gen-sw.mjs [--stdout]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSw } from '@hxym18/pwa-kit/sw'
import config from '../sw.config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '..', 'public', 'sw.js')
const version = process.env.SW_VERSION || config.version
const sw = buildSw({ ...config, version })

if (process.argv.includes('--stdout')) {
  process.stdout.write(sw)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, sw)
  console.log('已生成 ' + out + '（version=' + version + '）')
}
`

/**
 * 生成 PWA 接入文件（Next 站点）。
 * 返回**站点根相对路径**（与 authScaffold/dbScaffold 同约定）；由 cmdInitPwa 调 applyScaffold 落盘。
 * @returns {{ path: string, content: string }[]}
 */
export function pwaScaffold() {
  return [
    { path: 'sw.config.mjs', content: SW_CONFIG_MJS },
    { path: 'scripts/gen-sw.mjs', content: GEN_SW_MJS },
  ]
}

/**
 * 是否声明了 `@hxym18/pwa-kit`（deps/devDeps/peerDeps 合并视图）。
 * check 据此触发 PWA 判定——**声明即触发**，避免「声明并 import 却提交了拷贝产物」漏检。
 * @param {Record<string, string>} deps
 * @returns {boolean}
 */
export function pwaDeclared(deps) {
  const d = deps && typeof deps === 'object' ? deps : {}
  return Object.prototype.hasOwnProperty.call(d, '@hxym18/pwa-kit')
}

/**
 * 判 `gen-sw.mjs` 内容是否 import 共享包入口 `@hxym18/pwa-kit/sw`。
 * import / require / 动态 import 形态均可（统一为字符串字面量中的包路径）；
 * 非字符串内容（未提供）视为否。
 * @param {unknown} content gen-sw.mjs 内容
 * @returns {boolean}
 */
export function genScriptImportsPwaKit(content) {
  const s = typeof content === 'string' ? content : ''
  return /['"`]@hxym18\/pwa-kit\/sw['"`]/.test(s)
}

/**
 * 判定 PWA 站点接入问题（默认模式：不提交 sw.js + 有生成脚本且 import 共享包 + pwa-kit tag 锁版）。
 * `gen-sw.mjs` 存在但不 import `@hxym18/pwa-kit/sw`（自写死 SW）同样报问题——
 * 否则安全修复走 minor 发版无法送达该站（spec §S7）。
 * 不做 swDriftProblems：默认不提交 sw.js，无漂移比对对象。
 * @param {{ hasCommittedSw: boolean, genScriptPresent: boolean, genScriptImportsPwaKit?: boolean, pinned: boolean }} input
 * @returns {string[]}
 */
export function pwaCheckProblems(input) {
  const i = input || {}
  const problems = []
  if (i.hasCommittedSw) {
    problems.push('提交了 public/sw.js：SW 是构建产出（scripts/gen-sw.mjs 生成），请从版本库移除并加入 .gitignore')
  }
  if (!i.genScriptPresent) {
    problems.push('缺少 scripts/gen-sw.mjs：站点须在构建期从 @hxym18/pwa-kit/sw 生成 sw.js（hxym18 init pwa --write）')
  } else if (!i.genScriptImportsPwaKit) {
    problems.push('scripts/gen-sw.mjs 未 import @hxym18/pwa-kit/sw：SW 须由共享包生成，自写 SW 会与安全修复漂移（hxym18 init pwa --write）')
  }
  if (!i.pinned) {
    problems.push('@hxym18/pwa-kit 未 tag 锁版：须 github:everythingIsZero/pwa-kit#v<semver>（hxym18 add pwa-kit --write）')
  }
  return problems
}
