/**
 * contracts.mjs — L0 接缝契约副本生成器 + 包级 check（spec §5 / §7）
 *
 * 单源 + 内联 + 哈希（spec §0/§3）：
 *   - L0 单源文件落 `knowledge/integration/contracts/<name>@<ver>+<sha8>.json`；
 *   - 各消费包内联**逐字节相同**的副本 + `package.json` 的 `hxym18.contracts` 声明；
 *   - 包仓可**独立自校验**（声明 + 哈希）；跨仓相等（副本 == L0）由 L3 校。
 *
 * 生成器只在本仓（工作区）跑；**check 不依赖生成器**——包级 check 只读包内声明/副本。
 * 本模块零运行期依赖（只用 node 内置）；契约取值一律**从各包源码导出常量/源码文本读取**，
 * 不手抄（值改即哈希变、文件名变，漂移可检）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 阶段 1 契约语义版本统一为 1（spec §5） */
export const CONTRACT_VERSION = 1

/** 契约短名（清单 `contracts` 放最后） */
export const CONTRACT_NAMES = Object.freeze([
  'sensitive-prefixes',
  'endpoints',
  'cache-policy',
  'share-url-policy',
  'analytics-policy',
  'capability-projection',
  'facade',
  'contracts',
])

/** 短名 → 工作区相对包目录（root 下） */
export const PACKAGE_DIRS = Object.freeze({
  auth: 'Projects/auth',
  analytics: 'Projects/analytics',
  'pwa-kit': 'Projects/pwa-kit',
  'share-kit': 'Projects/share-kit',
  env: 'Projects/env',
  cli: 'Projects/cli',
})

/** 契约 → 消费方（= 需要内联副本的包；spec §5） */
export const CONTRACT_CONSUMERS = Object.freeze({
  'sensitive-prefixes': ['pwa-kit', 'analytics', 'auth', 'share-kit'],
  endpoints: ['auth', 'cli'],
  'cache-policy': ['pwa-kit'],
  'share-url-policy': ['share-kit'],
  'analytics-policy': ['analytics'],
  'capability-projection': ['env', 'auth', 'share-kit'],
  facade: ['auth'],
  // 清单：每个有副本的包都放一份（= 所有消费方并集）
  contracts: ['pwa-kit', 'analytics', 'auth', 'share-kit', 'cli', 'env'],
})

/** 递归键升序（数组保序）——与 `contracts/README.md` 口径一致 */
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortDeep(v[k])]),
    )
  }
  return v
}

/**
 * 契约内容哈希前 8 位（可复现口径，逐字对齐 `contracts/README.md`）。
 * 解析 JSON（若传字符串）→ 递归键升序 → 紧凑 `JSON.stringify` → sha256 → hex 前 8。
 * @param {unknown} content 解析后的 JSON 值，或其字符串（本模块只取解析后内容，与缩进/键序无关）
 * @returns {string}
 */
export function contractHash(content) {
  const value = typeof content === 'string' ? JSON.parse(content) : content
  return createHash('sha256').update(JSON.stringify(sortDeep(value)), 'utf8').digest('hex').slice(0, 8)
}

/** 落盘序列化（键升序、2 空格缩进、尾换行）——保证幂等 diff 稳定 */
function serializeContract(value) {
  return JSON.stringify(sortDeep(value), null, 2) + '\n'
}

/** 契约文件名：`<name>@<ver>+<sha8>.json` */
export function contractFilename(name, version, sha8) {
  return `${name}@${version}+${sha8}.json`
}

function sameStringSet(a, b) {
  const s = new Set(a)
  return a.length === b.length && b.every((x) => s.has(x))
}

/** 从 core.mjs 源码解析 `CORE_AUTH_ENDPOINTS` 动作串（以代码为准） */
export function parseCoreEndpoints(source) {
  const m = /CORE_AUTH_ENDPOINTS\s*=\s*(?:Object\.freeze\()?\s*\[([\s\S]*?)\]/.exec(source || '')
  if (!m) throw new Error('未在 core.mjs 找到 CORE_AUTH_ENDPOINTS')
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2])
}

/** 从 auth server.mjs 源码解析 `dispatch` 分支（action + method） */
export function parseAuthDispatch(source) {
  const out = []
  for (const m of (source || '').matchAll(/action === '([^']+)'\s*&&\s*method === '([A-Z]+)'/g)) {
    out.push({ action: m[1], method: m[2] })
  }
  if (out.length === 0) throw new Error('未在 auth/src/server.mjs 找到 dispatch 分支')
  return out
}

/** 对象字面量平衡切片（从 openIdx 的 `{` 起，含两端） */
function balancedObjectSlice(src, openIdx) {
  let depth = 0
  let inStr = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') {
        i++
      } else if (ch === inStr) {
        inStr = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  throw new Error('未闭合对象字面量')
}

/** 取正则匹配 `{`（匹配串末字符）起的对象字面量 */
function objectLiteralWhere(src, re) {
  const m = re.exec(src)
  if (!m) throw new Error(`未找到标记：${re}`)
  const open = m.index + m[0].lastIndexOf('{')
  if (m[0].lastIndexOf('{') < 0) throw new Error(`匹配未含对象起始：${re}`)
  return balancedObjectSlice(src, open)
}

/** 取包含 needle（字符串或正则）的对象字面量文本 */
function objectLiteralContaining(src, needle) {
  const re = needle instanceof RegExp ? needle : null
  let idx
  if (re) {
    const m = re.exec(src)
    if (!m) throw new Error(`未找到响应字面量：${re}`)
    idx = m.index
  } else {
    idx = src.indexOf(needle)
    if (idx < 0) throw new Error(`未找到响应字面量：${needle}`)
  }
  const open = src.lastIndexOf('{', idx)
  if (open < 0) throw new Error(`未找到对象起始：${needle}`)
  return balancedObjectSlice(src, open)
}

/** 平衡括号切片（含两端） */
function balancedSlice(src, openIdx, open, close) {
  let depth = 0
  let inStr = null
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === inStr) inStr = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  throw new Error('未闭合括号')
}

/**
 * 取对象字面量的**顶层键**（处理简写 `scene,`、`key:`）；`...(expr)` 展开里的键视为可选键，
 * 从展开表达式内嵌对象字面量再取一次（如 `...(confirm ? { confirm: true } : {})` → confirm）。
 * @param {string} literal 含外层 `{}`
 * @returns {string[]}
 */
export function responseKeysFromLiteral(literal) {
  const keys = []
  const n = literal.length
  let i = 1
  let depth = 1
  let inStr = null
  let expectKey = true
  while (i < n) {
    const ch = literal[i]
    if (inStr) {
      if (ch === '\\') i += 2
      else {
        if (ch === inStr) inStr = null
        i++
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch
      i++
      continue
    }
    if (ch === '/' && literal[i + 1] === '/') {
      const nl = literal.indexOf('\n', i)
      i = nl < 0 ? n : nl + 1
      continue
    }
    if (ch === '/' && literal[i + 1] === '*') {
      const end = literal.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      continue
    }
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      i++
      continue
    }
    if (ch === ',') {
      if (depth === 1) expectKey = true
      i++
      continue
    }
    if (ch === '.' && literal.slice(i, i + 3) === '...') {
      i += 3
      if (depth === 1) expectKey = true
      continue
    }
    if (depth === 1 && expectKey) {
      const m = /^[A-Za-z_$][\w$]*/.exec(literal.slice(i))
      if (m) {
        const name = m[0]
        let j = i + name.length
        while (j < n && /\s/.test(literal[j])) j++
        if (!keys.includes(name)) keys.push(name)
        if (literal[j] === ':') {
          expectKey = false
          i = j + 1
        } else {
          // 简写键（`scene`）——下一个 token 应是 `,` 或 `}`
          i = j
        }
        continue
      }
    }
    i++
  }
  return keys
}

/** 展开表达式（`...(...)` / `...{...}`）内嵌对象字面量的键（可选键） */
export function spreadKeysFromLiteral(literal) {
  const out = []
  for (const idx of [...literal.matchAll(/\.\.\./g)].map((m) => m.index)) {
    let j = idx + 3
    while (j < literal.length && /\s/.test(literal[j])) j++
    let slice = ''
    if (literal[j] === '(') slice = balancedSlice(literal, j, '(', ')')
    else if (literal[j] === '{') slice = balancedSlice(literal, j, '{', '}')
    else {
      const m = /^[A-Za-z_$][\w$]*/.exec(literal.slice(j))
      slice = m ? m[0] : ''
    }
    for (const m of slice.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
      if (!out.includes(m[1])) out.push(m[1])
    }
  }
  return out
}

function assertPrefixEqual(base, other, label) {
  if (!sameStringSet(base, [...other])) {
    throw new Error(`敏感前缀不一致：契约（pwa-kit）=${JSON.stringify(base)} vs ${label}=${JSON.stringify([...other])}`)
  }
}

const importRaw = (path) => import(pathToFileURL(path).href)

/**
 * 从工作区根读各包源码，构造 8 份契约内容（值从源码读，不手抄）。
 * @param {{ root?: string, version?: number }} [opts]
 * @returns {Promise<{ version: number, entries: Array<{name:string,version:number,sha8:string,filename:string,value:unknown,content:string}> }>}
 */
export async function buildContracts(opts = {}) {
  const root = resolve(opts.root || process.cwd())
  const version = opts.version || CONTRACT_VERSION
  const rel = (p) => resolve(root, p)

  const pwa = await importRaw(rel('Projects/pwa-kit/src/sw/policy.mjs'))
  const analytics = await importRaw(rel('Projects/analytics/src/core.mjs'))
  const authCore = await importRaw(rel('Projects/auth/src/core.mjs'))
  const envIndex = await importRaw(rel('Projects/env/src/capability.mjs'))
  const share = await importRaw(rel('Projects/share-kit/src/core/share-url.mjs'))
  const cliCore = await importRaw(rel('Projects/cli/src/core.mjs'))

  const authServerSrc = readFileSync(rel('Projects/auth/src/server.mjs'), 'utf8')
  const ssoSrc = readFileSync(rel('Projects/sso-bridge/auth-service.mjs'), 'utf8')

  // —— sensitive-prefixes：单源在 pwa-kit，与 analytics/auth 核对相等（spec §S1）——
  const prefixes = [...pwa.SENSITIVE_PREFIXES]
  assertPrefixEqual(prefixes, analytics.DEFAULT_DENY_PREFIXES, 'analytics.DEFAULT_DENY_PREFIXES')
  assertPrefixEqual(prefixes, authCore.SENSITIVE_PREFIXES, 'auth.SENSITIVE_PREFIXES')

  // —— endpoints：动作单源 CORE_AUTH_ENDPOINTS，方法来自 auth dispatch；两者必须一致 ——
  const dispatch = parseAuthDispatch(authServerSrc)
  const coreActions = [...cliCore.CORE_AUTH_ENDPOINTS]
  const dispatchActions = dispatch.map((d) => d.action)
  if (!sameStringSet(coreActions, dispatchActions)) {
    throw new Error(
      `端点不一致：CORE_AUTH_ENDPOINTS=${JSON.stringify(coreActions)} vs auth dispatch=${JSON.stringify(dispatchActions)}`,
    )
  }
  const methodByAction = new Map(dispatch.map((d) => [d.action, d.method]))
  const endpoints = coreActions.map((action) => ({ action, method: methodByAction.get(action) }))

  // —— cache-policy：策略/导航/敏感前缀/可缓存硬条件，由 policy 行为探针读取；不实现的项显式标注 ——
  const nav = pwa.decideRequest({ method: 'GET', sameOrigin: true, mode: 'navigate', path: '/' }, {})
  const ccCandidates = ['no-store', 'private', 'no-cache', 'public', 'max-age=60', 'immutable']
  const cacheControlExcludes = ccCandidates.filter(
    (t) => !pwa.cacheableResponse({ status: 200, cacheControl: t, vary: '' }),
  )
  const varyCandidates = ['cookie', 'authorization', '*', 'accept-encoding', 'accept-language']
  const varyExcludes = varyCandidates.filter(
    (t) => !pwa.cacheableResponse({ status: 200, cacheControl: 'public', vary: t }),
  )
  const okStatuses = [200, 206].filter((s) => pwa.cacheableResponse({ status: s, cacheControl: 'public', vary: '' }))
  const cachePolicy = {
    defaultStrategy: pwa.DEFAULT_STRATEGY,
    navigationStrategy: nav.strategy,
    sensitivePrefixes: prefixes,
    cacheableResponse: { statuses: okStatuses, cacheControlExcludes, varyExcludes },
    // 本 program 不实现（spec §S2 / §14）：离线与「公开可缓存导航」登记为后续
    publicCacheable: false,
    offlineUrl: false,
  }

  // —— share-url-policy：域/敏感 query 单源在 share-kit ——
  const shareUrlPolicy = {
    defaultPublicHosts: [...share.DEFAULT_PUBLIC_HOSTS],
    sensitiveQueryKeys: [...share.SENSITIVE_QUERY_KEYS],
    cardShareHosts: [...share.CARD_SHARE_HOSTS],
  }

  // —— analytics-policy：门控口径单源在 analytics ——
  const analyticsPolicy = {
    denyPrefixes: [...analytics.DEFAULT_DENY_PREFIXES],
    denyQueryKeys: [...analytics.DEFAULT_DENY_QUERY_KEYS],
    denyHashKeys: [...analytics.DEFAULT_DENY_HASH_KEYS],
    noindex: { ...analytics.NOINDEX_ROBOTS },
  }

  // —— capability-projection：env capabilities() 键集合 + auth 投影映射（行为探针） ——
  const capKeys = Object.keys(envIndex.capabilities({}))
  const falseBase = Object.fromEntries(capKeys.map((k) => [k, false]))
  const login = {}
  for (const k of capKeys) {
    const out = authCore.loginCapsFromCapabilities({ ...falseBase, [k]: true })
    for (const [ok, on] of Object.entries(out)) {
      if (on === true && !login[ok]) login[ok] = k
    }
  }
  const capabilityProjection = { capabilities: capKeys, login }

  // —— facade：sso-bridge 响应键（introspect/profile/qr.issue/qr.poll）；unionid 已落地（pending 为空） ——
  const introspectLit = objectLiteralContaining(ssoSrc, /ok:\s*true,\s*openid:\s*r\.openid/)
  const profileLit = objectLiteralContaining(ssoSrc, /ok:\s*true,\s*profile:\s*profile/)
  const issueLit = objectLiteralContaining(ssoSrc, 'qrUrl:')
  const pollLit = objectLiteralWhere(ssoSrc, /const result = \{/)
  const issueKeys = [...new Set([...responseKeysFromLiteral(issueLit), ...spreadKeysFromLiteral(issueLit)])]
  const pollAssign = [...ssoSrc.matchAll(/\bresult\.([A-Za-z_$][\w$]*)\s*=[^=]/g)].map((m) => m[1])
  const pollKeys = [...responseKeysFromLiteral(pollLit)]
  for (const k of pollAssign) if (!pollKeys.includes(k)) pollKeys.push(k)
  const facade = {
    operations: {
      introspect: { method: 'POST', responseKeys: responseKeysFromLiteral(introspectLit) },
      profile: { method: 'POST', responseKeys: responseKeysFromLiteral(profileLit) },
      'qr.issue': { method: 'POST', responseKeys: issueKeys },
      'qr.poll': { method: 'POST', responseKeys: pollKeys },
    },
    // spec §S10 / §12：unionid 已随门面回传（introspect/profile/qr.poll），pending 清空
    pending: [],
  }

  const values = {
    'sensitive-prefixes': { prefixes },
    endpoints: { endpoints },
    'cache-policy': cachePolicy,
    'share-url-policy': shareUrlPolicy,
    'analytics-policy': analyticsPolicy,
    'capability-projection': capabilityProjection,
    facade,
  }

  const entries = []
  for (const name of CONTRACT_NAMES) {
    if (name === 'contracts') continue
    const value = values[name]
    const sha8 = contractHash(value)
    entries.push({ name, version, sha8, filename: contractFilename(name, version, sha8), value, content: serializeContract(value) })
  }
  const contractsMap = Object.fromEntries(entries.map((e) => [e.name, `${e.version}+${e.sha8}`]))
  const manifestValue = { contracts: contractsMap }
  const manifestSha8 = contractHash(manifestValue)
  entries.push({
    name: 'contracts',
    version,
    sha8: manifestSha8,
    filename: contractFilename('contracts', version, manifestSha8),
    value: manifestValue,
    content: serializeContract(manifestValue),
  })

  return { version, entries }
}

/**
 * 规划生成：L0 写入 + 各包副本 + package.json 声明（不落盘）。
 * @param {{ root?: string, l0Dir?: string, packages?: Record<string,string[]> }} [opts]
 */
export async function planContracts(opts = {}) {
  const root = resolve(opts.root || process.cwd())
  const l0Dir = resolve(opts.l0Dir || join(root, 'knowledge/integration/contracts'))
  const consumers = opts.packages || CONTRACT_CONSUMERS
  const { version, entries } = await buildContracts({ root, version: opts.version })
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]))

  const l0Writes = entries.map((e) => ({ path: join(l0Dir, e.filename), content: e.content }))

  const copyWrites = []
  const pkgEdits = []
  for (const [name, pkgs] of Object.entries(consumers)) {
    const entry = byName[name]
    if (!entry) throw new Error(`消费方引用了未知契约：${name}`)
    for (const short of pkgs) {
      const dir = resolve(root, PACKAGE_DIRS[short] || `Projects/${short}`)
      copyWrites.push({ pkg: short, path: join(dir, 'contracts', entry.filename), content: entry.content })
    }
  }
  // package.json：各消费方声明其**全部**副本（含清单 contracts）
  const declaredByPkg = {}
  for (const [name, pkgs] of Object.entries(consumers)) {
    for (const short of pkgs) {
      declaredByPkg[short] = declaredByPkg[short] || {}
      declaredByPkg[short][name] = `${byName[name].version}+${byName[name].sha8}`
    }
  }
  for (const [short, contracts] of Object.entries(declaredByPkg)) {
    const dir = resolve(root, PACKAGE_DIRS[short] || `Projects/${short}`)
    const pkgPath = join(dir, 'package.json')
    const raw = readFileSync(pkgPath, 'utf8')
    const json = JSON.parse(raw)
    json.hxym18 = { ...(json.hxym18 || {}), contracts: { ...contracts } }
    pkgEdits.push({ pkg: short, path: pkgPath, content: JSON.stringify(json, null, 2) + '\n' })
  }

  // 清理：L0 与各包副本目录里不在本次计划内的旧版本产物
  const expected = new Set([...l0Writes.map((w) => w.path), ...copyWrites.map((w) => w.path)])
  const copyDirs = [...new Set(copyWrites.map((w) => dirname(w.path)))]
  const staleWrites = [l0Dir, ...copyDirs].flatMap((d) => findStaleContractFiles(d, expected))

  return { version, entries, l0Dir, l0Writes, copyWrites, pkgEdits, staleWrites }
}

/**
 * 旧版本孤儿产物（值改即文件名变）：目标目录里 `<name>@<ver>+<sha8>.json` 形态、
 * 但不在本次计划内的文件。不清理会在包内留下「多出未声明副本」，并让 L0 同名多份（`loadContract` 要求恰 1 份）。
 */
function findStaleContractFiles(dir, expected) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => CONTRACT_FILE_RE.test(f))
    .map((f) => join(dir, f))
    .filter((p) => !expected.has(p))
}

/**
 * 写 L0 目录 + 各包副本 + 更新各包 `package.json` 的 `hxym18.contracts` 声明。
 * 副本与 L0 **逐字节相同**；幂等（重复运行产物一致）。
 * @param {{ root?: string, l0Dir?: string, packages?: Record<string,string[]> }} [opts]
 */
export async function writeContracts(opts = {}) {
  const plan = await planContracts(opts)
  for (const w of [...plan.l0Writes, ...plan.copyWrites]) {
    mkdirSync(dirname(w.path), { recursive: true })
    writeFileSync(w.path, w.content)
  }
  for (const stale of plan.staleWrites || []) rmSync(stale, { force: true })
  for (const e of plan.pkgEdits) {
    writeFileSync(e.path, e.content)
  }
  return plan
}

/** 读目录下的 `*.json`（缺目录返 []） */
function listContractFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json'))
}

const CONTRACT_FILE_RE = /^(.+)@(\d+)\+([0-9a-f]{8})\.json$/

/**
 * 包级 check（spec §7）：声明/副本/哈希/L0 相等/端点完整/敏感前缀齐全。任一项不过 → 返回问题列表。
 * @param {{ pkgDir: string, l0Dir?: string|null }} opts
 * @returns {string[]}
 */
export function packageContractProblems(opts) {
  const pkgDir = resolve(opts.pkgDir)
  const problems = []
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) return [`找不到 ${pkgPath}`]
  let json
  try {
    json = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    return [`${pkgPath} 解析失败：${(e && e.message) || e}`]
  }
  const declared = json.hxym18 && json.hxym18.contracts
  if (!declared || typeof declared !== 'object' || Object.keys(declared).length === 0) {
    return [`未声明 hxym18.contracts（${pkgPath}）`]
  }
  const contractsDir = join(pkgDir, 'contracts')
  const files = listContractFiles(contractsDir)
  const fileSet = new Set(files)

  // ① 声明 ↔ 副本 一一对应
  const expectedFiles = new Map()
  for (const [name, spec] of Object.entries(declared)) {
    const filename = `${name}@${spec}.json`
    expectedFiles.set(filename, name)
    if (!fileSet.has(filename)) problems.push(`缺少副本：contracts/${filename}（声明 ${name}=${spec}）`)
  }
  for (const f of files) {
    if (!expectedFiles.has(f)) problems.push(`多出未声明的副本：contracts/${f}`)
    const m = CONTRACT_FILE_RE.exec(f)
    if (!m) problems.push(`副本命名不合规：contracts/${f}（应 <name>@<ver>+<sha8>.json）`)
  }

  const l0Dir = opts.l0Dir ? resolve(opts.l0Dir) : null
  const short = pkgDir.split(/[\\/]/).pop()

  // ② 副本内容哈希 == 文件名 sha8；③ 副本 == L0（逐字节）
  const copyPrefixesByName = {}
  for (const [filename] of expectedFiles) {
    if (!fileSet.has(filename)) continue
    const copyPath = join(contractsDir, filename)
    let text
    try {
      text = readFileSync(copyPath, 'utf8')
    } catch (e) {
      problems.push(`读副本失败：contracts/${filename}`)
      continue
    }
    const m = CONTRACT_FILE_RE.exec(filename)
    const sha8 = m ? m[3] : ''
    let actual = ''
    try {
      actual = contractHash(text)
    } catch (e) {
      problems.push(`副本 JSON 解析失败：contracts/${filename}`)
      continue
    }
    if (actual !== sha8) problems.push(`副本哈希不符：contracts/${filename}（实算 ${actual} ≠ 文件名 ${sha8}）`)
    try {
      const value = JSON.parse(text)
      const name = m ? m[1] : ''
      if (name === 'sensitive-prefixes') copyPrefixesByName[name] = value.prefixes || []
    } catch {
      /* 已在哈希处报错 */
    }
    if (l0Dir) {
      const l0Path = join(l0Dir, filename)
      if (!existsSync(l0Path)) {
        problems.push(`L0 缺该契约：${l0Path}`)
      } else if (readFileSync(l0Path, 'utf8') !== text) {
        problems.push(`副本与 L0 不一致：contracts/${filename}`)
      }
    }
  }

  // ④ 端点完整性（仅 auth/cli）：L0 endpoints == 该包端点定义
  if (l0Dir && (short === 'auth' || short === 'cli')) {
    const l0EndpointsFile = listContractFiles(l0Dir).find((f) => f.startsWith('endpoints@'))
    if (!l0EndpointsFile) {
      problems.push(`L0 缺 endpoints 契约（${l0Dir}）`)
    } else {
      const l0Value = JSON.parse(readFileSync(join(l0Dir, l0EndpointsFile), 'utf8'))
      const l0Actions = (l0Value.endpoints || []).map((e) => e.action)
      let pkgActions = []
      try {
        if (short === 'cli') {
          pkgActions = parseCoreEndpoints(readFileSync(join(pkgDir, 'src/core.mjs'), 'utf8'))
        } else {
          pkgActions = parseAuthDispatch(readFileSync(join(pkgDir, 'src/server.mjs'), 'utf8')).map((d) => d.action)
        }
      } catch (e) {
        problems.push(`端点定义解析失败（${short}）：${(e && e.message) || e}`)
      }
      if (pkgActions.length && !sameStringSet(l0Actions, pkgActions)) {
        problems.push(
          `端点不完整：L0=${JSON.stringify(l0Actions)} vs 包内=${JSON.stringify(pkgActions)}`,
        )
      }
    }
  }

  // ⑤ 敏感前缀副本齐全（仅声明了该契约的包）：副本前缀须 ⊇ L0（站点只能加不能减）
  if (copyPrefixesByName['sensitive-prefixes']) {
    let base = null
    if (l0Dir) {
      const l0PrefixFile = listContractFiles(l0Dir).find((f) => f.startsWith('sensitive-prefixes@'))
      if (l0PrefixFile) {
        base = JSON.parse(readFileSync(join(l0Dir, l0PrefixFile), 'utf8')).prefixes || null
      }
    }
    if (!base) {
      if (copyPrefixesByName['sensitive-prefixes'].length === 0) problems.push('sensitive-prefixes 副本为空')
    } else {
      for (const p of base) {
        if (!copyPrefixesByName['sensitive-prefixes'].includes(p)) problems.push(`sensitive-prefixes 缺基线前缀：${p}`)
      }
    }
  }

  return problems
}
