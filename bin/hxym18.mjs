#!/usr/bin/env node
/**
 * hxym18 —— 共享包接入 CLI
 *
 * 用法：
 *   hxym18 add <repo> [--write] [--dir <项目目录>]   解析最新 tag 并（可选）写入 package.json
 *   hxym18 check [dir]                                校验横切件接入（tag 锁版 / 旧包残留 / 死依赖），可失败
 *   hxym18 init auth [--target next|taro] [--write] [--dir <目录>]  生成 auth 接入文件（缺省自动探测项目类型）
 *   hxym18 init db [--write] [--dir <项目根>]                      生成后端数据层骨架（落 <根>/server/src/）
 *   hxym18 list                                       列出已知共享包
 *
 * 退出码：check 有问题 → 1；其余 0（打印类命令失败 → 1）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { KNOWN_PACKAGES, LEGACY_AUTH_PACKAGE, pinSpec, findPinProblems, depsForCheck, unusedShared, findLegacyRefs, authScaffold, taroAuthScaffold, dbScaffold, checkBaseline } from '../src/index.mjs'

function parseArgs(argv) {
  const out = { _: [], write: false, dir: null, baseline: null, strict: false, target: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--strict') out.strict = true
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--baseline') out.baseline = argv[++i]
    else if (a === '--target') out.target = argv[++i]
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

function cmdCheck(args) {
  const dir = args._[1] || args.dir || '.'
  const { json } = readPkg(dir)
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
  // 版本基线（advisory，--strict 视为失败）
  const baselinePath = args.baseline || process.env.HXYM18_BASELINE
  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(`hxym18: 基线文件不存在：${baselinePath}`)
    } else {
      let deviations = []
      try {
        deviations = checkBaseline(allDeps, JSON.parse(readFileSync(baselinePath, 'utf8')))
      } catch (e) {
        console.error(`hxym18: 基线文件解析失败 ${baselinePath}: ${(e && e.message) || e}`)
      }
      if (deviations.length) {
        const lines = deviations.map((d) => `  - ${d.name}: ${d.actual}（基线 ${d.expected}）`).join('\n')
        if (args.strict) {
          bad = true
          console.error(`✗ 与版本基线不一致（strict）：\n${lines}`)
        } else {
          console.warn(`⚠ 与版本基线不一致（advisory；加 --strict 视为失败）：\n${lines}`)
        }
      }
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
      '另需：package.json 加 @hxym18/auth + @hxym18/env（hxym18 add auth --write / hxym18 add env --write）。客户端接线 + Hono 服务端装配已生成；只补 server/src/auth.ts 的 resolveIdentity（唯一业务回调）。',
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
    '按需替换 migrations 里的示例表；在服务启动处调用 migrate()。规范默认后端 = Hono + better-sqlite3 + 版本化迁移。',
  )
}

function cmdInitStats(args) {
  const dir = args.dir || '.'
  console.log(`stats（业务统计只读出口）接入清单（${dir}）：`)
  console.log('  1. 业务事件写入**本项目库**的业务表（不进共享库）')
  console.log('  2. 只读出口 GET /api/ops/stats：带 `x-ops-token` 才可读（token = env OPS_STATS_TOKEN）')
  console.log('  3. 缺项≠0：读不到给 null，界面显「—」')
  console.log('  参考实现：fang apps/fang/src/app/api/ops/stats/route.ts')
  return 0
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  try {
    if (cmd === 'list') return cmdList()
    if (cmd === 'add') return cmdAdd(args)
    if (cmd === 'check') return cmdCheck(args)
    if (cmd === 'init') {
      const sub = args._[1]
      if (sub === 'auth') return cmdInitAuth(args)
      if (sub === 'db') return cmdInitDb(args)
      if (sub === 'stats') return cmdInitStats(args)
      console.error('init 支持：auth | db | stats')
      return 1
    }
    console.error('用法：hxym18 <add|check|init auth|init db|init stats|list> ...')
    return 1
  } catch (e) {
    console.error(`hxym18: ${(e && e.message) || e}`)
    return 1
  }
}

process.exit(main())
