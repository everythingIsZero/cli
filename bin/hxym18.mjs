#!/usr/bin/env node
/**
 * hxym18 —— 共享包接入 CLI
 *
 * 用法：
 *   hxym18 add <repo> [--write] [--dir <项目目录>]   解析最新 tag 并（可选）写入 package.json
 *   hxym18 check [dir]                                校验横切件接入（tag 锁版 / 旧包残留），可失败
 *   hxym18 init auth [--dir <目录>]                   打印 auth 接入所需文件清单（dry-run）
 *   hxym18 list                                       列出已知共享包
 *
 * 退出码：check 有问题 → 1；其余 0（打印类命令失败 → 1）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { KNOWN_PACKAGES, LEGACY_AUTH_PACKAGE, pinSpec, findPinProblems, findLegacyRefs, authScaffold, checkBaseline } from '../src/index.mjs'

function parseArgs(argv) {
  const out = { _: [], write: false, dir: null, baseline: null, strict: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--strict') out.strict = true
    else if (a === '--dir') out.dir = argv[++i]
    else if (a === '--baseline') out.baseline = argv[++i]
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
  const problems = findPinProblems(json.dependencies || {})
  const srcDir = resolve(dir, 'src')
  // 旧包残留：粗扫 src（存在才扫）
  let legacy = []
  if (existsSync(srcDir)) {
    try {
      const grep = execFileSync('grep', ['-rlF', LEGACY_AUTH_PACKAGE, srcDir], { encoding: 'utf8' })
      legacy = grep.split('\n').filter(Boolean)
    } catch {
      /* grep 无匹配退出 1 */
    }
  }
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
  // 版本基线（advisory，--strict 视为失败）
  const baselinePath = args.baseline || process.env.HXYM18_BASELINE
  if (baselinePath) {
    if (!existsSync(baselinePath)) {
      console.error(`hxym18: 基线文件不存在：${baselinePath}`)
    } else {
      let deviations = []
      try {
        deviations = checkBaseline(json.dependencies || {}, JSON.parse(readFileSync(baselinePath, 'utf8')))
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

function cmdInitAuth(args) {
  const dir = args.dir || '.'
  const hasSrc = existsSync(resolve(dir, 'src/app'))
  const srcDir = hasSrc ? 'src' : ''
  if (!hasSrc && !existsSync(resolve(dir, 'app'))) {
    console.error(`hxym18: 未检测到 ${dir}/src/app 或 ${dir}/app（Next App Router）；仍按无 src 生成，请核对路径。`)
  }
  const planned = authScaffold({ srcDir }).map((f) => ({
    ...f,
    full: resolve(dir, f.path),
    exists: existsSync(resolve(dir, f.path)),
  }))
  if (args.write) {
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
    console.log(`\n完成，写入 ${wrote} 个文件。请补 lib/auth-routes.ts 的 resolveIdentity，并加 @hxym18/auth 依赖。`)
  } else {
    console.log(`auth 接入将生成（dry-run，加 --write 写入 ${dir}）：`)
    for (const f of planned) console.log(`  ${f.exists ? '（已存在，跳过）' : ''}${f.path}`)
    console.log(`\n另需：package.json 加 @hxym18/auth（hxym18 add auth --write）；env: AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET。`)
  }
  return 0
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  try {
    if (cmd === 'list') return cmdList()
    if (cmd === 'add') return cmdAdd(args)
    if (cmd === 'check') return cmdCheck(args)
    if (cmd === 'init' && args._[1] === 'auth') return cmdInitAuth(args)
    console.error('用法：hxym18 <add|check|init auth|list> ...')
    return 1
  } catch (e) {
    console.error(`hxym18: ${(e && e.message) || e}`)
    return 1
  }
}

process.exit(main())
