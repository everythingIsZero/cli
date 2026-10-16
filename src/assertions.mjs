/**
 * assertions.mjs — `hxym18 check` 的站点级兜底断言（T17b）
 *
 * 定位：生成器/模板能消除的先在生成器侧消除（见 pwaScaffold / project-scaffold），
 * 这里只做「站点已接共享件、但接法退化」的兜底判定。全部为**纯函数**（零依赖、
 * 不碰文件系统），由 bin 收齐证据后调用；方便单测与反例。
 *
 * 语义：所有断言**默认 advisory**（打印 ⚠，不改 exit 码），`--strict` 才视为失败。
 * 值缺失即失败——不得靠 `if (val != null)` 跳过（元准则 / 执行规则 4）。
 */

/** 统计门控修复版（hash 路由闸：analytics v0.3.0）。低于此版会漏拦 Taro hash 路由敏感参数。 */
export const MIN_ANALYTICS_VERSION = '0.3.0'

/** `AUTH_INTERNAL_URL` 许可值：门面统一登录服务内网地址 / 跨机地址。其余视为陈旧值（TOOL-8）。 */
export const AUTH_INTERNAL_URL_ALLOWED = Object.freeze([
  'http://sso-unified-next:8100',
  'https://auth.hxym18.com',
])

/** 登录门面 origin（OPS-9：站点不得硬编码，须从 `@hxym18/auth/core` 的 `AUTH_ORIGIN` 取）。 */
export const AUTH_ORIGIN = 'https://auth.hxym18.com'

import { CORE_AUTH_ENDPOINTS } from './core.mjs'

const CODE_COMMENT_RE = /^\s*(?:\/\/|\/\*|\*)/

/** 从 tag 锁版串取 semver（`github:…#v1.2.3` → `1.2.3`）；非锁版 → null。 */
export function parsePinnedTag(spec) {
  const m = /#v?(\d+\.\d+\.\d+)\s*$/.exec(String(spec == null ? '' : spec))
  return m ? m[1] : null
}

/** semver 比较：a>b → 1，a<b → -1，相等 → 0。 */
export function compareSemver(a, b) {
  const p = (s) => String(s).replace(/^v/, '').split('.').map(Number)
  const [x1, y1, z1] = p(a)
  const [x2, y2, z2] = p(b)
  return x1 - x2 || y1 - y2 || z1 - z2
}

/**
 * TOOL-14：判「站点落后 vs 基线陈旧」的方向。
 * @param {string} expected 基线值
 * @param {string} actual 站点值
 * @returns {'match'|'site-behind'|'baseline-stale'|'unknown'}
 */
export function baselineDirection(expected, actual) {
  const e = parsePinnedTag(expected)
  const a = parsePinnedTag(actual)
  if (!e || !a) return 'unknown'
  const c = compareSemver(a, e)
  if (c < 0) return 'site-behind'
  if (c > 0) return 'baseline-stale'
  return 'match'
}

/**
 * TOOL-14：带方向的基线比对（不改 `checkBaseline` 的既有返回形状，避免破坏既有调用/测试）。
 * @returns {{ name: string, expected: string, actual: string, direction: string }[]}
 */
export function baselineDeviations(deps, baseline) {
  const b = baseline && typeof baseline === 'object' ? baseline : null
  if (!b || !b.packages || typeof b.packages !== 'object') return []
  const d = deps && typeof deps === 'object' ? deps : {}
  const out = []
  for (const [name, expected] of Object.entries(b.packages)) {
    const actual = d[name]
    if (actual === undefined) continue
    if (actual === expected) continue
    out.push({ name, expected, actual, direction: baselineDirection(expected, actual) })
  }
  return out
}

// ---------------------------------------------------------------- PWA（TOOL-1..5）

/**
 * TOOL-1 / TOOL-2：PWA 构建链 + 运行镜像。
 * 判定（pwa-kit 已声明时触发）：
 *   - 构建期须调用 `scripts/gen-sw.mjs`（Dockerfile 或 package.json build 脚本任一）；
 *   - 有 Dockerfile 时：须 `test -n "$SW_VERSION"` 守卫 + 运行阶段 `COPY … public ./public`。
 * @param {{ dockerfiles?: string[], buildScript?: string }} input
 * @returns {string[]}
 */
export function pwaBuildChainProblems(input = {}) {
  const dockerfiles = Array.isArray(input.dockerfiles) ? input.dockerfiles : []
  const buildScript = typeof input.buildScript === 'string' ? input.buildScript : ''
  const df = dockerfiles.join('\n')
  const problems = []

  const genInDocker = /gen-sw(\.mjs)?\b/.test(df)
  const genInBuild = /gen-sw(\.mjs)?\b/.test(buildScript)
  if (!genInDocker && !genInBuild) {
    problems.push('TOOL-1 构建期未调用 scripts/gen-sw.mjs：SW 是构建产出，须在镜像构建或 build 脚本里生成（hxym18 init pwa --write）')
  }
  if (dockerfiles.length > 0 && !/test\s+-n\s+["']?\$SW_VERSION/.test(df)) {
    problems.push('TOOL-1 构建期未校验 SW_VERSION 非空：容器无 .git，缺 `test -n "$SW_VERSION"` 会静默产出无版本 SW')
  }
  if (dockerfiles.length > 0 && !/COPY\s+--from=\S+[^\n]*\/public\s+\.\/public/.test(df)) {
    problems.push('TOOL-2 运行镜像未 `COPY … public ./public`：sw.js 生成在 public/，缺该段线上读不到（片段见 Dockerfile.pwa-snippet）')
  }
  return problems
}

/**
 * TOOL-3 / DEF-4：`/sw.js` 服务头须 no-cache（否则 HTTP 缓存卡住 SW 升级）。
 * 认三种接法：`withPwaKit`（Next）、next.config 手写 `/sw.js` no-cache、Hono `/sw.js` 中间件。
 * @param {{ nextConfigs?: string[], honoApps?: string[] }} input
 * @returns {string[]}
 */
export function swHeaderProblems(input = {}) {
  const nextConfigs = Array.isArray(input.nextConfigs) ? input.nextConfigs : []
  const honoApps = Array.isArray(input.honoApps) ? input.honoApps : []
  const nc = nextConfigs.join('\n')
  const ha = honoApps.join('\n')

  const hasWithPwaKit = /@hxym18\/pwa-kit\/next/.test(nc) && /withPwaKit\s*\(/.test(nc)
  const hasNextHeader = /['"`]\/sw\.js['"`]/.test(nc) && /no-cache/i.test(nc)
  const hasHonoHeader = /['"`]\/sw\.js['"`]/.test(ha) && /no-cache/i.test(ha) && /Cache-Control/i.test(ha)
  if (hasWithPwaKit || hasNextHeader || hasHonoHeader) return []
  return [
    'TOOL-3 /sw.js 无 no-cache 头：SW 被 HTTP 缓存会卡住升级。Next 站用 `withPwaKit`（@hxym18/pwa-kit/next，见 next.config.pwa-snippet）；Hono 站在 `/sw.js` 中间件补 `Cache-Control: no-cache`',
  ]
}

/**
 * TOOL-5 / DEF-6：`public/sw.js` 须被忽略（`git ls-files` 只抓「已提交」，抓不到「将来会误提交」）。
 *
 * 判定顺序（P-4 修正）：**先问 git**（`ignoredByGit`，`git check-ignore` —— 仓库根的 `.gitignore`
 * 同样生效，monorepo 站的 `apps/<x>/public/sw.js` 记在根 `.gitignore` 里也能认出来）；判不了
 * （非 git 仓 / git 不可用 → `null`）才回落「只读扫描目录内 `.gitignore` 文本」这条旧路径。
 * @param {{ gitignores?: string[], ignoredByGit?: boolean|null }} input
 * @returns {string[]}
 */
export function gitignoreSwProblems(input = {}) {
  if (input.ignoredByGit === true) return []
  if (input.ignoredByGit === false) {
    return ['TOOL-5 .gitignore 未忽略 public/sw.js：SW 是构建产出，未忽略易被误提交（脚手架模板 templates/project-scaffold/.gitignore 已含该行）']
  }
  const gitignores = Array.isArray(input.gitignores) ? input.gitignores : []
  const text = gitignores.join('\n')
  const covered = /^\s*(?:apps\/[^/\s]+\/)?public\/sw\.js\s*$/m.test(text)
  if (covered) return []
  return ['TOOL-5 .gitignore 未忽略 public/sw.js：SW 是构建产出，未忽略易被误提交（脚手架模板 templates/project-scaffold/.gitignore 已含该行）']
}

/**
 * TOOL-4 / B6：manifest `id` / maskable 图标 + `apple-touch-icon`。
 * 用 `@hxym18/pwa-kit/manifest` 的 `buildManifest` 时，`id`/maskable 由包默认兜底，只查 apple-touch-icon。
 *
 * apple 一项的判据（P-4 修正）：**代码里声明**（layout metadata 的 `icons.apple` / `apple-touch-icon`）
 * **或**站内已有图标**文件**（`appleIconFiles`，如 `public/apple-touch-icon.png`——iOS 在无 link 标签时
 * 会自动请求该根路径，Next 的 `apple-icon.*` 文件约定同理）都算通过；只看代码会把「图标其实有」判成没有。
 * @param {{ manifests?: string[], layouts?: string[], appleIconFiles?: string[] }} input
 * @returns {string[]}
 */
export function manifestProblems(input = {}) {
  const manifests = Array.isArray(input.manifests) ? input.manifests : []
  const layouts = Array.isArray(input.layouts) ? input.layouts : []
  const appleIconFiles = Array.isArray(input.appleIconFiles) ? input.appleIconFiles : []
  const problems = []
  const text = manifests.join('\n')

  if (manifests.length === 0) {
    problems.push('TOOL-4 未找到 manifest：PWA 站须声明 manifest（Next `manifest.ts` / `public/manifest.webmanifest`）')
  } else if (!/@hxym18\/pwa-kit\/manifest/.test(text) && !/buildManifest\s*\(/.test(text)) {
    if (!/["']?id["']?\s*[:=]/.test(text)) {
      problems.push("TOOL-4 manifest 缺 id：start_url/scope 漂移会致重复安装（或改用 @hxym18/pwa-kit/manifest 的 buildManifest 默认 id:'/'）")
    }
    if (!/maskable/.test(text)) {
      problems.push('TOOL-4 manifest 无 maskable 图标：Android 安装图标会被裁切（purpose: "maskable"）')
    }
  }
  const lt = layouts.join('\n')
  // apple-touch-icon：**代码行**声明（注释行不算：注释里写 `apple:` 会让 iOS 图标缺失却假绿）
  // 或**站内已有图标文件**（P-4：iOS 自动请求 /apple-touch-icon.png；Next app 目录的 apple-icon.* 同效）。
  const appleInCode = lt
    .split('\n')
    .some((line) => !CODE_COMMENT_RE.test(line) && (/apple-touch-icon/.test(line) || /apple\s*:\s*['"[{]/.test(line)))
  if (!appleInCode && appleIconFiles.length === 0) {
    problems.push('TOOL-4/B6 缺 apple-touch-icon：iOS 加到主屏无图标（layout metadata 的 `icons.apple`，或放 public/apple-touch-icon.png）')
  }
  return problems
}

// ---------------------------------------------------------------- auth（TOOL-6..8 / §4 动作③）

/**
 * TOOL-6：`resolveIdentity` 不得留生成器占位（`hxym18 init auth` 的 `throw new Error('resolveIdentity 未实现')`）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function resolveIdentityPlaceholderProblems(sources = []) {
  const hits = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    if (typeof content === 'string' && content.includes('resolveIdentity 未实现')) hits.push(path || '(unknown)')
  }
  return hits.length
    ? [`TOOL-6 resolveIdentity 仍是生成器占位（未实现）：${hits.join('、')}——须补本站身份锚定（openid/unionid → user）`]
    : []
}

/**
 * TOOL-7：Hono catch-all 必须末位注册（I15）。
 * 同文件内：共享 auth 通配注册行之后，不得再出现站点自有 `/api/auth/<业务>` 路由定义（会被通配吞掉）。
 * 跨文件挂载顺序由 `scripts/e2e/hono-catchall-order.test.mjs` 用真 Hono 验（纯文本判不了框架匹配顺序）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function honoCatchAllOrderProblems(sources = []) {
  const core = new Set(CORE_AUTH_ENDPOINTS)
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const s = typeof content === 'string' ? content : ''
    if (!s) continue
    const lines = s.split('\n')
    const catchAllIdx = lines.findIndex(
      (l) =>
        !CODE_COMMENT_RE.test(l) &&
        (/\.(?:all|use)\s*\(\s*['"`]\/api\/auth\/\*['"`]/.test(l) ||
          /\.route\s*\(\s*['"`]\/['"`]\s*,\s*authRoutes/.test(l)),
    )
    if (catchAllIdx < 0) continue
    for (let i = catchAllIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (CODE_COMMENT_RE.test(line)) continue
      const m = /\.(?:get|post|put|delete|all|use|route)\(\s*['"`]\/api\/auth\/([^/\s'"`?*]+)/.exec(line)
      if (!m || core.has(m[1])) continue
      problems.push(`TOOL-7 ${path}: site 自有端点 /api/auth/${m[1]} 注册在 auth catch-all 之后 → 会被通配吞掉（catch-all 须末位）`)
    }
  }
  return problems
}

/** 取 `.env.example`/`.env` 里 `AUTH_INTERNAL_URL` 的有效值（去引号、去空白）。 */
export function authInternalUrls(envFiles = []) {
  const out = []
  for (const { path, content } of Array.isArray(envFiles) ? envFiles : []) {
    const re = /^\s*AUTH_INTERNAL_URL\s*=\s*(.*)$/gm
    let m
    while ((m = re.exec(String(content || '')))) {
      const val = m[1].trim().replace(/^["']|["']$/g, '')
      if (val) out.push({ path, value: val })
    }
  }
  return out
}

/**
 * TOOL-8：`AUTH_INTERNAL_URL` 值不漂移（陈旧值 = 指到已下线门面，登录会 503/404）。
 * 许可值 = AUTH_INTERNAL_URL_ALLOWED（内网统一门面 / 跨机地址）。
 * @param {{ path: string, content: string }[]} envFiles
 * @returns {string[]}
 */
export function authEnvDriftProblems(envFiles = []) {
  const problems = []
  for (const { path, value } of authInternalUrls(envFiles)) {
    if (AUTH_INTERNAL_URL_ALLOWED.includes(value)) continue
    problems.push(`TOOL-8 ${path}: AUTH_INTERNAL_URL=${value} 是陈旧值（许可 ${AUTH_INTERNAL_URL_ALLOWED.join(' | ')}）`)
  }
  return problems
}

/**
 * §4 动作③ / OPS-9：禁硬编码登录门面 origin `https://auth.hxym18.com`（须 `AUTH_ORIGIN` from `@hxym18/auth/core`）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function ssoOriginHardcodeProblems(sources = []) {
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const lines = String(content || '').split('\n')
    lines.forEach((line, i) => {
      if (CODE_COMMENT_RE.test(line)) return
      if (!line.includes(AUTH_ORIGIN)) return
      if (/from\s+['"]@hxym18\/auth\/core['"]/.test(line)) return
      problems.push(`SSO_AUTH_BASE 硬编码：${path}:${i + 1} 出现 ${AUTH_ORIGIN}（应 import { AUTH_ORIGIN } from '@hxym18/auth/core'）`)
    })
  }
  return problems
}

/**
 * §4 动作③：禁站点重写 `consumeReturn`（回跳消费）/ `wx-poll` 轮询（应走 `@hxym18/auth` controller）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function loginFlowRewriteProblems(sources = []) {
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const s = String(content || '')
    if (!s) continue
    if (
      /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+consumeReturn\b/.test(s) ||
      /(?:^|\n)\s*(?:export\s+)?const\s+consumeReturn\s*=/.test(s)
    ) {
      problems.push(`consumeReturn 自写：${path} 重写了 ?sso=return 回跳消费（应走 @hxym18/auth 的 login.consumeReturn()）`)
    }
    if (/setInterval\s*\(/.test(s) && /(wx-poll|\/api\/auth\/wx-poll|qrcode|二维码|扫码)/i.test(s)) {
      problems.push(`轮询自写：${path} 用 setInterval 轮询二维码/票据（应走 @hxym18/auth controller 的共享轮询）`)
    }
  }
  return problems
}

// ---------------------------------------------------------------- 统计（TOOL-9）

/**
 * TOOL-9：统计只走共享入口、版本 ≥ 门控修复版。
 * - 已声明 @hxym18/analytics 时：tag 版本 < MIN_ANALYTICS_VERSION 报「版本不足」；
 * - 硬编码 `u.hxym18.com` 报「未走共享入口」（共享包已导出默认 src）。
 * @param {{ deps?: Record<string,string>, sources?: { path: string, content: string }[] }} input
 * @returns {string[]}
 */
export function analyticsProblems(input = {}) {
  const deps = input.deps && typeof input.deps === 'object' ? input.deps : {}
  const sources = Array.isArray(input.sources) ? input.sources : []
  const spec = deps['@hxym18/analytics']
  if (spec === undefined) return []
  const problems = []
  const tag = parsePinnedTag(spec)
  if (tag && compareSemver(tag, MIN_ANALYTICS_VERSION) < 0) {
    problems.push(
      `TOOL-9 @hxym18/analytics ${tag} < 门控修复版 ${MIN_ANALYTICS_VERSION}：hash/query 敏感参数会漏拦（hxym18 add analytics --write）`,
    )
  }
  for (const { path, content } of sources) {
    const lines = String(content || '').split('\n')
    lines.forEach((line, i) => {
      if (CODE_COMMENT_RE.test(line)) return
      if (!line.includes('u.hxym18.com')) return
      problems.push(`TOOL-9 ${path}:${i + 1} 硬编码统计脚本地址 u.hxym18.com（应走 @hxym18/analytics 的共享入口/默认 src）`)
    })
  }
  return problems
}

// ---------------------------------------------------------------- UA（TOOL-11）

const UA_REGEX_RE = /\/(?:[^/\n\\]|\\.)*(?:MicroMessenger|Android|iPhone|iPad|iPod|Macintosh|Windows\\s?NT|Mobile)(?:[^/\n\\]|\\.)*\/[a-z]*\.(?:test|exec)\s*\(/i
const UA_TEST_RE = /\.(?:test|match|includes)\s*\(\s*(?:[A-Za-z0-9_.]*\.)?(?:navigator\.)?userAgent/

/**
 * TOOL-11：站点不得手写 UA 判定（应走 `@hxym18/env` 的 `capabilities()`）。
 * 放行「把 ua 传给共享能力位」的写法（`capabilities({ ua: … })` / `ua: navigator.userAgent`）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function handWrittenUaProblems(sources = []) {
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const lines = String(content || '').split('\n')
    lines.forEach((line, i) => {
      if (CODE_COMMENT_RE.test(line)) return
      const regexTest = UA_REGEX_RE.test(line)
      const uaTest = UA_TEST_RE.test(line)
      if (!regexTest && !uaTest) return
      // 把 ua 交给共享能力位：`ua:` 参数行 / `capabilities({ … ua: … })`，且此行无 UA 正则判定
      const isCapabilitiesArg = /capabilities\s*\(\s*\{/.test(line) || /^\s*ua\s*:/.test(line)
      if (isCapabilitiesArg && !regexTest) return
      problems.push(`TOOL-11 ${path}:${i + 1} 手写 UA 判定（应走 @hxym18/env 的 capabilities()，含桌面微信/小程序 webview）`)
    })
  }
  return problems
}

// ---------------------------------------------------------------- TOOL-15 未接站「应接什么」

/**
 * TOOL-15：站点出现某能力面（登录/PWA/统计/UA）却未接对应共享包 → 报「应接什么」。
 * 仅当该包**未声明**时提示；已声明的站由各自专项断言覆盖。
 * @param {{ declared?: Record<string,string>, signs?: Record<string, boolean> }} input
 * @returns {string[]}
 */
export function adoptionGapProblems(input = {}) {
  const declared = input.declared && typeof input.declared === 'object' ? input.declared : {}
  const signs = input.signs && typeof input.signs === 'object' ? input.signs : {}
  const has = (pkg) => Object.prototype.hasOwnProperty.call(declared, pkg)
  const problems = []
  const want = (pkg, why) => {
    if (!has(pkg)) problems.push(`TOOL-15 站点 ${why} 却未接 ${pkg}（hxym18 add ${pkg.replace('@hxym18/', '')} --write）`)
  }
  if (signs.loginSurface) want('@hxym18/auth', '有登录/门面接线（SSO 或 /api/auth）')
  if (signs.pwaSurface) want('@hxym18/pwa-kit', '有 manifest / Service Worker 注册')
  if (signs.analyticsSurface) want('@hxym18/analytics', '有自托管统计脚本')
  if (signs.uaSurface) want('@hxym18/env', '有终端/UA 判定')
  return problems
}

// ---------------------------------------------------------------- TOOL-12/13 结果校验

/**
 * TOOL-12：db 骨架校验（生成器已归 T4，此处只校验站点产物）。
 * 任一 `db.ts`/`db.mjs`/`db.js` 须 WAL + 迁移调用点。
 * 迁移调用点认三种既有形态（不误伤存量站）：
 *   - `migrate` 前缀函数调用（`migrate(db)` / `migrateLegacyRows(db, …)`）；
 *   - 幂等 `ALTER TABLE`（存量站 `PRAGMA table_info` 守卫 + `ALTER TABLE … ADD COLUMN`）；
 *   - `user_version`（版本化迁移：`PRAGMA user_version` / `db.pragma('user_version')`）。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function dbSkeletonProblems(sources = []) {
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const base = String(path || '').split('/').pop()
    if (base !== 'db.ts' && base !== 'db.mjs' && base !== 'db.js') continue
    const s = String(content || '')
    if (!/journal_mode\s*=\s*WAL/.test(s)) problems.push(`TOOL-12 ${path} 缺 journal_mode = WAL（SQLite 并发写；hxym18 init db）`)
    const hasMigration =
      /\bmigrate[A-Za-z0-9_$]*\s*\(/.test(s) ||
      /\buser_version\b/i.test(s) ||
      /ALTER\s+TABLE\b/i.test(s)
    if (!hasMigration) {
      problems.push(`TOOL-12 ${path} 缺迁移调用点（migrate(db) / 幂等 ALTER TABLE / PRAGMA user_version；hxym18 init db）`)
    }
  }
  return problems
}

/**
 * TOOL-13：`/api/ops/stats` 出口校验（生成器已归 T4，此处只校验站点产物）。
 * 须 `x-ops-token` + `OPS_STATS_TOKEN` + 定长比较 + `no-store` + 503/403。
 * @param {{ path: string, content: string }[]} sources
 * @returns {string[]}
 */
export function opsStatsProblems(sources = []) {
  const problems = []
  for (const { path, content } of Array.isArray(sources) ? sources : []) {
    const p = String(path || '')
    if (!/\/api\/ops\/stats\//.test(p)) continue
    const s = String(content || '')
    if (!/x-ops-token/.test(s)) problems.push(`TOOL-13 ${p} 未校验 x-ops-token（统计出口须头 token 鉴权）`)
    if (!/OPS_STATS_TOKEN/.test(s)) problems.push(`TOOL-13 ${p} 未读 OPS_STATS_TOKEN（未配置须 503，不得裸奔）`)
    if (!/timingSafeEqual/.test(s)) problems.push(`TOOL-13 ${p} 未用定长比较（timingSafeEqual，防时序侧信道）`)
    if (!/no-store/.test(s)) problems.push(`TOOL-13 ${p} 缺 Cache-Control: no-store`)
  }
  return problems
}

/**
 * TOOL-15 的能力面信号（纯函数；bin 传收齐的文本）。
 * @param {{ sources?: { content: string }[], manifests?: string[], layouts?: string[] }} input
 * @returns {{ loginSurface: boolean, pwaSurface: boolean, analyticsSurface: boolean, uaSurface: boolean }}
 */
export function adoptionSigns(input = {}) {
  const sources = Array.isArray(input.sources) ? input.sources : []
  const manifests = Array.isArray(input.manifests) ? input.manifests : []
  const layouts = Array.isArray(input.layouts) ? input.layouts : []
  const text = sources.map((s) => String(s.content || '')).join('\n')
  const layoutText = layouts.join('\n')
  return {
    loginSurface: /https:\/\/auth\.hxym18\.com/.test(text) || /\/api\/auth\//.test(text) || /useSsoLogin|createAuthRoutes|createHonoAuthRoutes/.test(text),
    pwaSurface:
      manifests.length > 0 ||
      /navigator\.serviceWorker|serviceWorker\.register|PwaRegister/.test(text) ||
      /manifest\s*:\s*['"]/.test(layoutText),
    analyticsSurface: /u\.hxym18\.com/.test(text) || /\bumami\b/i.test(text),
    uaSurface: handWrittenUaProblems(sources).length > 0,
  }
}

/**
 * 汇总执行：按证据跑全部 T17b 断言。
 * @param {object} evidence bin 收齐的证据（见 scanSite）
 * @returns {{ tool: string[], auth: string[], analytics: string[], ua: string[], adoption: string[], data: string[] }}
 */
export function runSiteAssertions(evidence = {}) {
  const e = evidence && typeof evidence === 'object' ? evidence : {}
  const declaredDeps = e.deps && typeof e.deps === 'object' ? e.deps : {}
  const sources = Array.isArray(e.sources) ? e.sources : []
  const pwa = e.pwaDeclared === true
  return {
    tool: pwa
      ? [
          ...pwaBuildChainProblems({ dockerfiles: e.dockerfiles, buildScript: e.buildScript }),
          ...swHeaderProblems({ nextConfigs: e.nextConfigs, honoApps: e.honoApps }),
          ...gitignoreSwProblems({ gitignores: e.gitignores, ignoredByGit: e.ignoredByGit }),
          ...manifestProblems({ manifests: e.manifests, layouts: e.layouts, appleIconFiles: e.appleIconFiles }),
        ]
      : [],
    auth: [
      ...resolveIdentityPlaceholderProblems(sources),
      ...honoCatchAllOrderProblems(sources),
      ...authEnvDriftProblems(e.envFiles),
      ...ssoOriginHardcodeProblems(sources),
      ...loginFlowRewriteProblems(sources),
    ],
    analytics: analyticsProblems({ deps: declaredDeps, sources }),
    ua: handWrittenUaProblems(sources),
    adoption: adoptionGapProblems({ declared: declaredDeps, signs: adoptionSigns({ sources, manifests: e.manifests, layouts: e.layouts }) }),
    data: [...dbSkeletonProblems(sources), ...opsStatsProblems(sources)],
  }
}
