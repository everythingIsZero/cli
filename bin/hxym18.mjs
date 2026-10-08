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
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { KNOWN_PACKAGES, LEGACY_AUTH_PACKAGE, pinSpec, findPinProblems, findLegacyRefs } from '../src/index.mjs'

function parseArgs(argv) {
  const out = { _: [], write: false, dir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') out.write = true
    else if (a === '--dir') out.dir = argv[++i]
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
  if (!bad) console.log(`✓ ${dir} 接入检查通过`)
  return bad ? 1 : 0
}

function cmdInitAuth(args) {
  const dir = args.dir || '.'
  console.log(`auth 接入（@hxym18/auth）需在 ${dir} 具备：`)
  console.log('  1. package.json: "@hxym18/auth": "github:everythingIsZero/auth#v<semver>"（用 hxym18 add auth --write）')
  console.log('  2. 服务端：src/lib/auth-routes.ts 用 createAuthRoutes（@hxym18/auth/next），声明 resolveIdentity')
  console.log('  3. 路由：app/api/auth/{sso-verify,wx-qrcode,wx-poll,logout,config}/route.ts（转发 routes.*）')
  console.log('  4. 客户端：登录页用 useSsoLogin（@hxym18/auth/react）+ capabilities（@hxym18/env）')
  console.log('  5. env: AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET（+ AUTH_ISSUE_ORG 可选）')
  console.log('  契约与示例见 knowledge/integration/ 与 @hxym18/auth/README.md')
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
