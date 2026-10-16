#!/usr/bin/env node
/**
 * hxym18 —— 共享包接入 CLI
 *
 * 用法：
 *   hxym18 add <repo> [--write] [--dir <项目目录>]   解析最新 tag 并（可选）写入 package.json
 *   hxym18 check [dir]                                校验横切件接入（tag 锁版 / 旧包残留 / 死依赖），可失败
 *   hxym18 check <包目录> --contracts <L0 目录>        包级契约校验（声明/副本/哈希/L0 相等/端点/前缀），可失败
 *   hxym18 gen contracts [--root <工作区根>] [--l0 <L0 目录>] [--write]  生成契约 L0 + 包内副本 + 声明
 *   hxym18 init auth [--target next|taro] [--write] [--dir <目录>]  生成 auth 接入文件（缺省自动探测项目类型）
 *   hxym18 init db [--write] [--dir <项目根>]                      生成后端数据层骨架（落 <根>/server/src/，含迁移调用点）
 *   hxym18 init pwa [--write] [--dir <站点根>]                     生成 PWA 接入文件（sw.config.mjs + scripts/gen-sw.mjs + Dockerfile.pwa-snippet）
 *   hxym18 init stats [--write] [--dir <站点根>]                   生成只读统计出口（/api/ops/stats + x-ops-token；Next App Router）
 *   hxym18 list                                       列出已知共享包
 *
 * 退出码：check 有问题 → 1；其余 0（打印类命令失败 → 1）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, basename, join } from 'node:path'
import { KNOWN_PACKAGES, LEGACY_AUTH_PACKAGE, pinSpec, isTagPin, findPinProblems, depsForCheck, unusedShared, findLegacyRefs, selfWrittenCoreEndpoints, authScaffold, taroAuthScaffold, dbScaffold, pwaScaffold, statsScaffold, pwaDeclared, pwaCheckProblems, genScriptImportsPwaKit, baselineDeviations, runSiteAssertions, planContracts, writeContracts, packageContractProblems } from '../src/index.mjs'

function parseArgs(argv) {
  const out = { _: [], write: false, dir: null, baseline: null, strict: false, target: null, root: null, l0: null, contracts: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--strict') out.strict = true
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--baseline') out.baseline = argv[++i]
    else if (a === '--target') out.target = argv[++i]
    else if (a === '--root') out.root = argv[++i]
    else if (a === '--l0') out.l0 = argv[++i]
    else if (a === '--contracts') out.contracts = argv[++i]
    else out._.push(a)
  }
  return out
}

function cmpSemver(a, b) {
  const p = (s) => s.replace(/^v/, '').split('.').map(Number)
  const [x1, y1, z1] = p(a)
  const [x2, y2, z2] = p(b)
  return x1 - x2 || y1 - y2 || z1 - z2
}

function resolveLatestTag(repo) {
  const out = execFileSync(
    'git',
    ['ls-remote', '--tags', '--refs', `https://github.com/everythingIsZero/${repo}`],
    { encoding: 'utf8' },
  )
  const tags = out
    .split('\n')
    .map((l) => (l.split('refs/tags/')[1] || '').trim())
    .filter((t) => /^v?\d+\.\d+\.\d+$/.test(t))
  if (tags.length === 0) throw new Error(`未找到 ${repo} 的版本 tag`)
  tags.sort(cmpSemver)
  return tags[tags.length - 1]
}

function readPkg(dir) {
  const p = resolve(dir, 'package.json')
  if (!existsSync(p)) throw new Error(`找不到 ${p}`)
  return { path: p, json: JSON.parse(readFileSync(p, 'utf8')) }
}

function cmdList() {
  for (const [short, name] of Object.entries(KNOWN_PACKAGES)) {
    console.log(`${short.padEnd(12)} ${name}   github:everythingIsZero/${short}#v<semver>`)
  }
}

function cmdAdd(args) {
  const repo = args._[1]
  if (!repo || !KNOWN_PACKAGES[repo]) {
    console.error(`用法：hxym18 add <${Object.keys(KNOWN_PACKAGES).join('|')}> [--write] [--dir <dir>]`)
    return 1
  }
  const tag = resolveLatestTag(repo)
  const spec = pinSpec(repo, tag)
  console.log(`${KNOWN_PACKAGES[repo]}@${spec}`)
  if (args.write) {
    const dir = args.dir || '.'
    const { path, json } = readPkg(dir)
    json.dependencies = json.dependencies || {}
    json.dependencies[KNOWN_PACKAGES[repo]] = spec
    writeFileSync(path, JSON.stringify(json, null, 2) + '\n')
    console.log(`已写入 ${path}；请运行 pnpm install`)
  } else {
    console.log(`（dry-run）加 --write 写入 ${args.dir || '.'}/package.json`)
  }
  return 0
}

/** 读文件为字符串；读失败返回 ''（由调用方按「缺失即失败」处理）。 */
function readMaybe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch (e) {
    return ''
  }
}

/** `find` 包装：异常（find 不可用）返回 []。 */
function findFiles(dir, args) {
  try {
    return execFileSync('find', [dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean)
  } catch (e) {
    return []
  }
}

/** `git rev-parse --show-toplevel`：拿仓库根（非 git 仓/git 不可用 → null）。 */
function gitToplevel(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch (e) {
    return null
  }
}

/**
 * `git check-ignore` 判某路径是否被忽略（P-4）：**跨目录正确**——仓库根的 `.gitignore`
 * 也生效，而只读扫描目录里的 `.gitignore` 会漏（monorepo 站点的根 `.gitignore` 覆盖 `apps/<x>/public/sw.js`）。
 * @returns {boolean|null} true=已忽略 · false=未忽略 · null=判不了（非 git 仓/git 不可用）→ 调用方回落文本扫描
 */
function gitIgnored(dir, rel) {
  try {
    execFileSync('git', ['-C', dir, 'check-ignore', '-q', '--', rel], { stdio: 'ignore' })
    return true
  } catch (e) {
    return e && e.status === 1 ? false : null
  }
}

// 扫描时排除：依赖 / 构建产物 / VCS；测试文件不算站点运行代码（与既有端点扫描同口径）。
const SCAN_PRUNE = ['-not', '-path', '*/node_modules/*', '-not', '-path', '*/.next/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/dist/*', '-not', '-path', '*/build/*']
const TEST_PATH_RE = /(?:\/tests?\/|\.test\.|\.spec\.)/

/**
 * 收齐站点级断言证据（T17b）：给 runSiteAssertions 的纯函数用。
 * 只读，不落盘；无对应文件时给空数组（由断言本身判「缺失即失败」）。
 */
function scanSite(dir) {
  const codeFiles = []
  for (const g of ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs']) {
    codeFiles.push(...findFiles(dir, ['-type', 'f', '-name', g, ...SCAN_PRUNE]))
  }
  const uniqCode = [...new Set(codeFiles)].filter((p) => !TEST_PATH_RE.test(p))
  const sources = uniqCode.map((p) => ({ path: p, content: readMaybe(p) }))

  const readAll = (nameArgs) => findFiles(dir, ['-type', 'f', ...nameArgs, ...SCAN_PRUNE]).map(readMaybe).filter(Boolean)

  const dockerfiles = readAll(['-name', 'Dockerfile'])
  const nextConfigs = readAll(['-name', 'next.config.*'])
  const gitignores = readAll(['-name', '.gitignore'])
  const manifests = readAll(['-name', 'manifest.*'])
  const layouts = [...readAll(['-name', 'layout.*']), ...readAll(['-name', 'index.html'])]
  // iOS 主屏图标：`public/apple-touch-icon.png` 会被 iOS **自动请求**（无 link 标签也生效），
  // 以及 Next 的 app 目录文件约定 `apple-icon.(png|svg|…)`——两者都算「有图标」（P-4）。
  const appleIconFiles = [
    ...findFiles(dir, ['-type', 'f', '-iname', 'apple-touch-icon*', ...SCAN_PRUNE]),
    ...findFiles(dir, ['-type', 'f', '-iname', 'apple-icon.*', ...SCAN_PRUNE]),
  ]
  // 只收 Hono 装配文件（含 `new Hono(`，允许 `new Hono<Env>(` 泛型）；/sw.js 头判定用它。
  const honoApps = sources.filter((s) => /new\s+Hono\s*(?:<[^>]*>)?\s*\(/.test(s.content)).map((s) => s.content)
  // P-4：Taro/前后端分仓站点的 `/sw.js` 头在**仓库根的 `server/`**（如 nuantie），不在站点目录内——
  // 只扫给定目录会把「已设 no-cache」判成没设。仅当仓库根确有 `server/`（本生态约定的后端目录）才并入。
  const toplevel = gitToplevel(dir)
  if (toplevel) {
    const serverDir = join(toplevel, 'server')
    if (existsSync(serverDir) && resolve(serverDir) !== resolve(dir)) {
      const serverFiles = []
      for (const g of ['*.ts', '*.js', '*.mjs', '*.cjs']) {
        serverFiles.push(...findFiles(serverDir, ['-type', 'f', '-name', g, ...SCAN_PRUNE]))
      }
      for (const p of [...new Set(serverFiles)].filter((f) => !TEST_PATH_RE.test(f))) {
        const text = readMaybe(p)
        if (/new\s+Hono\s*(?:<[^>]*>)?\s*\(/.test(text)) honoApps.push(text)
      }
    }
  }
  // P-4：是否忽略 `public/sw.js` 交给 git 判（根 `.gitignore` 也生效）；判不了（非 git 仓）→ null 回落文本扫描。
  const ignoredByGit = gitIgnored(dir, 'public/sw.js')

  const envFiles = []
  for (const name of ['.env.example', '.env']) {
    for (const p of findFiles(dir, ['-type', 'f', '-name', name, ...SCAN_PRUNE])) {
      envFiles.push({ path: p, content: readMaybe(p) })
    }
  }

  // build 脚本：monorepo 里 build 可能在任意 package.json（站点根/app 包）
  const buildScripts = []
  // 声明的 @hxym18/*（跨全仓 package.json 取并集）：TOOL-15/TOOL-9 判「站点是否接过共享包」，
  // 必须在 monorepo 根也成立（根 package.json 通常无依赖，站点依赖在各 app 包）。
  const declaredShared = {}
  for (const p of findFiles(dir, ['-type', 'f', '-name', 'package.json', ...SCAN_PRUNE])) {
    try {
      const j = JSON.parse(readMaybe(p) || '{}')
      // P-4：认**构建链**脚本值（`build` / `pre·postbuild` 及其 `:` 变体）——Taro 站的 SW 生成挂在
      // `build:h5` 上，只认 `scripts.build` 会把「已调 gen-sw」判成没调。
      // 不取全部 `scripts.*`：独立的 `gen:sw` 助手不算「构建期生成」（那会把真漏报放过去）。
      if (j.scripts && typeof j.scripts === 'object') {
        for (const [k, v] of Object.entries(j.scripts)) {
          if (typeof v !== 'string') continue
          if (/^(pre|post)?build(:.*)?$/.test(k)) buildScripts.push(v)
        }
      }
      for (const block of [j.dependencies, j.devDependencies, j.peerDependencies]) {
        if (block && typeof block === 'object') {
          for (const [k, v] of Object.entries(block)) {
            if (k.startsWith('@hxym18/')) declaredShared[k] = v
          }
        }
      }
    } catch (e) {
      // package.json 解析失败：不影响断言（build 脚本缺失会由 TOOL-1 报）
    }
  }

  return {
    sources,
    dockerfiles,
    nextConfigs,
    honoApps,
    gitignores,
    ignoredByGit,
    manifests,
    layouts,
    appleIconFiles,
    envFiles,
    buildScript: buildScripts.join('\n'),
    declaredShared,
  }
}

function cmdCheck(args) {
  const dir = args._[1] || args.dir || '.'
  const { json } = readPkg(dir)
  // 包级契约校验（spec §7）：--contracts 显式触发，或包已声明 hxym18.contracts 自动触发。
  // 站点（无 hxym18.contracts）维持既有站点级行为不变。
  const declared = json.hxym18 && json.hxym18.contracts
  if (args.contracts || (declared && Object.keys(declared).length)) return cmdCheckContracts(args, dir)
  const allDeps = depsForCheck(json)
  const problems = findPinProblems(allDeps)
  // 旧包残留：只扫**代码文件**里的引用（import/require 等）+ package.json 依赖键，
  // 不把 README/Dockerfile 里的历史叙述当残留。
  const codeGlobs = ['--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx', '--include=*.mjs', '--include=*.cjs']
  let legacy = []
  let grepFailed = false
  try {
    const grep = execFileSync(
      'grep',
      ['-rlF', ...codeGlobs, '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=.git', '--exclude-dir=dist', LEGACY_AUTH_PACKAGE, dir],
      { encoding: 'utf8' },
    )
    legacy = grep.split('\n').filter(Boolean)
  } catch (e) {
    // grep 退出码 1 = 无匹配（正常）；其余（含 grep 缺失）视为扫描失败——不得静默通过。
    if (!(e && e.status === 1)) grepFailed = true
  }
  const legacyDep =
    (json.dependencies || {})[LEGACY_AUTH_PACKAGE] ||
    (json.devDependencies || {})[LEGACY_AUTH_PACKAGE] ||
    (json.peerDependencies || {})[LEGACY_AUTH_PACKAGE]
  if (legacyDep) legacy.push(`package.json 依赖：${LEGACY_AUTH_PACKAGE}=${legacyDep}`)
  // 声明了「可导入」的 @hxym18/* 却未 import（死依赖，nuantie env 曾漏网）——grep 失败时不判，避免误报。
  const present = []
  if (!grepFailed) {
    for (const pkg of Object.values(KNOWN_PACKAGES)) {
      if (!(pkg in allDeps)) continue
      try {
        execFileSync(
          'grep',
          ['-rlF', ...codeGlobs, '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=.git', '--exclude-dir=dist', pkg, dir],
          { encoding: 'utf8' },
        )
        present.push(pkg)
      } catch (e) {
        // 仅「无匹配（exit 1）」= 未出现；其余错误不确定 → 视为已出现，避免误报死依赖。
        if (!(e && e.status === 1)) present.push(pkg)
      }
    }
  }
  const unused = grepFailed ? [] : unusedShared(Object.keys(allDeps), present)
  let bad = false
  if (problems.length) {
    bad = true
    console.error(`✗ 未 tag 锁版的 @hxym18/* 依赖（${dir}）：`)
    for (const p of problems) console.error(`  - ${p.name}: ${p.spec}（应 github:everythingIsZero/<repo>#v<semver>）`)
  }
  if (legacy.length) {
    bad = true
    console.error(`✗ 旧包名 ${LEGACY_AUTH_PACKAGE} 残留：`)
    for (const f of legacy) console.error(`  - ${f}`)
  }
  if (grepFailed) {
    bad = true
    console.error(`✗ 旧包名残留扫描失败（grep 不可用或异常，${dir}）：不得视为通过`)
  }
  if (unused.length) {
    bad = true
    console.error(`✗ 声明了但未 import 的共享包（死依赖，${dir}）：`)
    for (const p of unused) console.error(`  - ${p}（package.json 有，代码未引用；删依赖或接入）`)
  }
  // 自写 auth core 端点（I5/I14 半接入漂移）：站点只应「挂载 + resolveIdentity + 业务端点」。
  // 路由文件路径 + handler 内容双扫；命中 core 端点（config/dev-login/...）即失败。
  let coreEndpointHits = []
  let endpointScanFailed = false
  try {
    const routeFiles = execFileSync(
      'find',
      [dir, '-type', 'f', '-path', '*/api/auth/*', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.next/*', '-not', '-path', '*/.git/*', '-not', '-path', '*/dist/*'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
    let handlerLines = []
    try {
      handlerLines = execFileSync(
        'grep',
        ['-rnE', '/api/auth/', ...codeGlobs, '--exclude-dir=node_modules', '--exclude-dir=.next', '--exclude-dir=.git', '--exclude-dir=dist', dir],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean)
    } catch (e) {
      // 仅「无匹配（exit 1）」正常；其余异常向上抛 → 记为扫描失败。
      if (!(e && e.status === 1)) throw e
    }
    coreEndpointHits = [...new Set(selfWrittenCoreEndpoints([...routeFiles, ...handlerLines]))]
  } catch (e) {
    endpointScanFailed = true
  }
  if (coreEndpointHits.length) {
    bad = true
    console.error(`✗ 自写 auth core 端点（${dir}）：core 端点由 @hxym18/auth 单源提供，站点只留「挂载 + resolveIdentity + 业务端点」`)
    for (const h of coreEndpointHits) console.error(`  - ${h}`)
  }
  if (endpointScanFailed) {
    bad = true
    console.error(`✗ 自写 core 端点扫描失败（find/grep 不可用或异常，${dir}）：不得视为通过`)
  }
  // PWA 接入（init pwa 生成物）：不提交 sw.js + 有生成脚本且 import @hxym18/pwa-kit/sw + pwa-kit tag 锁版。
  // 触发条件 = 声明 @hxym18/pwa-kit（声明即触发，命中「拷贝产物」失败模式）；默认 advisory，--strict 视为失败。
  if (pwaDeclared(allDeps)) {
    const genScriptPath = resolve(dir, 'scripts/gen-sw.mjs')
    const genScriptPresent = existsSync(genScriptPath)
    // gen-sw.mjs 存在还不够（S7）：须 import @hxym18/pwa-kit/sw（自写死 SW 会与安全修复漂移）。
    let genScriptImports = false
    if (genScriptPresent) {
      try {
        genScriptImports = genScriptImportsPwaKit(readFileSync(genScriptPath, 'utf8'))
      } catch (e) {
        // 读失败视为未 import → 报问题（不得静默视为通过）
      }
    }
    let hasCommittedSw = false
    try {
      const tracked = execFileSync('git', ['-C', dir, 'ls-files', '--', 'public/sw.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      hasCommittedSw = tracked.length > 0
    } catch (e) {
      // 非 git 仓库 / git 不可用：无法判定是否提交 → 视为未提交，避免误报。
    }
    const pwaProblems = pwaCheckProblems({
      hasCommittedSw,
      genScriptPresent,
      genScriptImportsPwaKit: genScriptImports,
      pinned: isTagPin(allDeps['@hxym18/pwa-kit']),
    })
    if (pwaProblems.length) {
      const lines = pwaProblems.map((p) => `  - ${p}`).join('\n')
      if (args.strict) {
        bad = true
        console.error(`✗ PWA 接入问题（strict，${dir}）：\n${lines}`)
      } else {
        console.warn(`⚠ PWA 接入问题（advisory；加 --strict 视为失败，${dir}）：\n${lines}`)
      }
    }
  }
  // 版本基线（advisory，--strict 视为失败）
  const baselinePath = args.baseline || process.env.HXYM18_BASELINE
  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      // fail-closed（P-8）：路径写错 = 门禁静默失效，比误报危险得多 → 一律 exit≠0（与 --strict 无关）。
      bad = true
      console.error(`✗ 基线文件不存在：${baselinePath}`)
      console.error('  基线门禁就此失效——核对 `--baseline` 路径（相对 cwd）或 HXYM18_BASELINE；不指向基线时请去掉该参数。')
    } else {
      let deviations = []
      try {
        deviations = baselineDeviations(allDeps, JSON.parse(readFileSync(baselinePath, 'utf8')))
      } catch (e) {
        // fail-closed（P-8）：解析失败同样不得静默通过（半截 JSON / 指错文件）。
        bad = true
        console.error(`✗ 基线文件解析失败 ${baselinePath}: ${(e && e.message) || e}`)
      }
      if (deviations.length) {
        // TOOL-14：判方向——站点落后（应升站）vs 基线陈旧（站点已领先，应更新 baseline.json）。
        const lines = deviations
          .map((d) => {
            const dirTag =
              d.direction === 'site-behind'
                ? '站点落后'
                : d.direction === 'baseline-stale'
                  ? '基线陈旧（站点已领先，更新 baseline.json）'
                  : '方向未知'
            return `  - ${d.name}: ${d.actual}（基线 ${d.expected}；${dirTag}）`
          })
          .join('\n')
        if (args.strict) {
          bad = true
          console.error(`✗ 与版本基线不一致（strict）：\n${lines}`)
        } else {
          console.warn(`⚠ 与版本基线不一致（advisory；加 --strict 视为失败）：\n${lines}`)
        }
      }
    }
  }
  // 站点级兜底断言（T17b：PWA 构建链 / auth 漂移 / 统计门控 / UA / 未接站「应接什么」/ db·stats 结果校验）。
  // 默认 advisory（打印 ⚠），`--strict` 才 exit≠0——不改既有默认行为，存量绿站不会突然失败。
  const evidence = scanSite(dir)
  evidence.deps = { ...allDeps, ...evidence.declaredShared }
  evidence.pwaDeclared = pwaDeclared(evidence.deps)
  const groups = runSiteAssertions(evidence)
  const messages = [...groups.tool, ...groups.auth, ...groups.analytics, ...groups.ua, ...groups.adoption, ...groups.data]
  if (messages.length) {
    const lines = messages.map((m) => `  - ${m}`).join('\n')
    if (args.strict) {
      bad = true
      console.error(`✗ 站点接入断言（strict，${dir}）：\n${lines}`)
    } else {
      console.warn(`⚠ 站点接入断言（advisory；加 --strict 视为失败，${dir}）：\n${lines}`)
    }
  }
  if (!bad) console.log(`✓ ${dir} 接入检查通过`)
  return bad ? 1 : 0
}

/** 把 scaffold 文件落盘（dry-run 只列）；路径相对 `base` 解析 */
function applyScaffold(files, base, write, note) {
  const planned = files.map((f) => ({ ...f, full: resolve(base, f.path), exists: existsSync(resolve(base, f.path)) }))
  if (write) {
    let wrote = 0
    for (const f of planned) {
      if (f.exists) {
        console.log(`跳过（已存在）：${f.path}`)
        continue
      }
      mkdirSync(dirname(f.full), { recursive: true })
      writeFileSync(f.full, f.content)
      console.log(`写入：${f.path}`)
      wrote++
    }
    console.log(`\n完成，写入 ${wrote} 个文件。${note || ''}`)
  } else {
    console.log(`将生成（dry-run，加 --write 写入）：`)
    for (const f of planned) console.log(`  ${f.exists ? '（已存在，跳过）' : ''}${f.path}`)
    if (note) console.log(`\n${note}`)
  }
  return 0
}

/** 探测项目类型：Next App Router 还是 Taro。 */
function detectAuthTarget(dir) {
  const hasNext = existsSync(resolve(dir, 'src/app')) || existsSync(resolve(dir, 'app'))
  const taroMarkers = ['src/app.tsx', 'src/app.ts', 'src/app.config.ts', 'app.tsx', 'app.ts', 'app.config.ts']
  const hasTaro = taroMarkers.some((m) => existsSync(resolve(dir, m)))
  return { hasNext, hasTaro }
}

function cmdInitAuth(args) {
  const dir = args.dir || '.'
  const { hasNext, hasTaro } = detectAuthTarget(dir)
  // 显式 --target 优先；否则按项目特征自动判定；两者皆无/皆中 → fail-closed（不写错文件）。
  const target = args.target || (hasNext && !hasTaro ? 'next' : hasTaro && !hasNext ? 'taro' : null)
  if (!target) {
    console.error(
      `hxym18: 无法判定项目类型（${dir}）：Next=${hasNext} Taro=${hasTaro}。请显式指定 --target next|taro。`,
    )
    return 1
  }
  if (target === 'next') {
    const srcDir = existsSync(resolve(dir, 'src/app')) ? 'src' : ''
    return applyScaffold(
      authScaffold({ srcDir }),
      dir,
      args.write,
      '另需：package.json 加 @hxym18/auth（hxym18 add auth --write）；补 lib/auth-routes.ts 的 resolveIdentity；env: AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET。',
    )
  }
  if (target === 'taro') {
    const srcDir = existsSync(resolve(dir, 'src')) ? 'src' : ''
    return applyScaffold(
      taroAuthScaffold({ srcDir }),
      dir,
      args.write,
      '另需：package.json 加 @hxym18/auth + @hxym18/env（hxym18 add auth --write / hxym18 add env --write）。客户端接线 + Hono 服务端装配已生成；只补 server/src/auth.ts 的 resolveIdentity（唯一业务回调）。挂载时**先注册站点自有 /api/auth/* 端点，最后 app.route(\'/\', authRoutes)**（catch-all 末位，避免吞站点端点）。',
    )
  }
  console.error(`hxym18: 未知 --target「${target}」，支持 next | taro。`)
  return 1
}

function cmdInitDb(args) {
  // --dir = 项目根（与 init auth 统一语义）；db 固定落 <root>/server/src/
  const root = args.dir || '.'
  return applyScaffold(
    dbScaffold({ dir: 'server/src' }),
    root,
    args.write,
    '按需替换 migrations 里的示例表；迁移调用点已在 db.ts 的 getDb() 内（首次建连接即应用未执行迁移）。规范默认后端 = Hono + better-sqlite3 + 版本化迁移。',
  )
}

function cmdInitPwa(args) {
  // --dir = 站点根；生成 sw.config.mjs + scripts/gen-sw.mjs + Dockerfile.pwa-snippet（站点根相对路径）
  const dir = args.dir || '.'
  return applyScaffold(
    pwaScaffold(),
    dir,
    args.write,
    '另需：package.json 加 @hxym18/pwa-kit（hxym18 add pwa-kit --write）；把 Dockerfile.pwa-snippet 两段合入 Dockerfile；next.config.pwa-snippet.mjs 示范用 withPwaKit 包外层（注入 /sw.js no-cache，勿手写 headers()）；构建前置 node scripts/gen-sw.mjs（SW_VERSION 必填，部署主机注入 git SHA）；.gitignore 忽略 public/sw.js（sw.js 为构建产出，不提交）。',
  )
}

function cmdInitStats(args) {
  // --dir = 站点根；生成 <src>/lib/ops-stats.ts + <src>/app/api/ops/stats/route.ts（Next App Router）
  const dir = args.dir || '.'
  const srcDir = existsSync(resolve(dir, 'src/app')) ? 'src' : ''
  return applyScaffold(
    statsScaffold({ srcDir }),
    dir,
    args.write,
    '另需：package.json 有 next（App Router）；env 配 OPS_STATS_TOKEN（值单源=部署 .env）；补 ops-stats.ts 里 buildOpsStats 的本站只读查询（缺项填 null，显「—」，不得填 0）。参考实现：fang apps/fang/src/app/api/ops/stats/route.ts。',
  )
}

/** 包级契约 check（spec §7）：声明/副本/哈希/L0 相等/端点/前缀。任一项不过 → exit 1。 */
function cmdCheckContracts(args, dir) {
  const pkgDir = resolve(dir)
  let l0Dir = args.contracts
  if (!l0Dir) {
    // 自动探测：包目录位于 Projects/<pkg>，则工作区 L0 在 ../../knowledge/integration/contracts
    const guess = resolve(pkgDir, '../../knowledge/integration/contracts')
    if (existsSync(guess)) l0Dir = guess
  }
  const problems = packageContractProblems({ pkgDir, l0Dir: l0Dir || null })
  if (problems.length) {
    console.error(`✗ 包级契约校验失败（${dir}）：`)
    for (const p of problems) console.error(`  - ${p}`)
    return 1
  }
  console.log(`✓ ${dir} 包级契约校验通过${l0Dir ? `（L0=${l0Dir}）` : '（自校验：声明+哈希+前缀）'}`)
  return 0
}

/** 契约副本生成器（spec §5）：L0 + 各包副本 + package.json 声明。默认 dry-run。 */
async function cmdGenContracts(args) {
  const opts = { root: args.root || '.' }
  if (args.l0) opts.l0Dir = args.l0
  const plan = await planContracts(opts)
  if (!args.write) {
    console.log(`将生成契约（dry-run，加 --write 落盘）：`)
    console.log(`L0 目录：${plan.l0Dir}`)
    for (const e of plan.entries) console.log(`  L0   ${e.filename}`)
    for (const w of plan.copyWrites) console.log(`  副本 ${w.pkg.padEnd(10)} contracts/${basename(w.path)}`)
    for (const e of plan.pkgEdits) console.log(`  声明 ${e.pkg.padEnd(10)} package.json → hxym18.contracts`)
    return 0
  }
  const done = await writeContracts(opts)
  console.log(
    `已写入：L0 ${done.l0Writes.length} 份；副本 ${done.copyWrites.length} 份；声明 ${done.pkgEdits.length} 个包`,
  )
  return 0
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  try {
    if (cmd === 'list') return cmdList()
    if (cmd === 'add') return cmdAdd(args)
    if (cmd === 'check') return cmdCheck(args)
    if (cmd === 'gen') {
      const sub = args._[1]
      if (sub === 'contracts') return cmdGenContracts(args)
      console.error('gen 支持：contracts')
      return 1
    }
    if (cmd === 'init') {
      const sub = args._[1]
      if (sub === 'auth') return cmdInitAuth(args)
      if (sub === 'db') return cmdInitDb(args)
      if (sub === 'pwa') return cmdInitPwa(args)
      if (sub === 'stats') return cmdInitStats(args)
      console.error('init 支持：auth | db | pwa | stats')
      return 1
    }
    console.error('用法：hxym18 <add|check|gen contracts|init auth|init db|init pwa|init stats|list> ...')
    return 1
  } catch (e) {
    console.error(`hxym18: ${(e && e.message) || e}`)
    return 1
  }
}

Promise.resolve()
  .then(() => main())
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`hxym18: ${(e && e.message) || e}`)
    process.exit(1)
  })
