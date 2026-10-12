/**
 * generators.test.mjs — `hxym18 init db|pwa|stats` 生成器端到端：
 *   产物含关键行 + dry-run 不落盘 + 二次运行幂等（不重复写）。
 * 真跑 bin（process.execPath，与 check.test.mjs 同约定）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))

/** 跑 init 子命令；返回 { code, out }（stdout+stderr 合并；非零不抛） */
function runInit(sub, dir, extra = []) {
  const r = spawnSync(process.execPath, [BIN, 'init', sub, '--dir', dir, ...extra], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

function tmp() {
  return mkdtempSync(join(tmpdir(), 'hxym18-gen-'))
}

test('init pwa：dry-run 不落盘；--write 产出四件 + 关键行；二次运行幂等', () => {
  const dir = tmp()
  try {
    // dry-run：只列不写
    const dry = runInit('pwa', dir)
    assert.equal(dry.code, 0, dry.out)
    assert.match(dry.out, /dry-run/)
    for (const rel of ['sw.config.mjs', 'scripts/gen-sw.mjs', 'Dockerfile.pwa-snippet', 'next.config.pwa-snippet.mjs']) {
      assert.equal(existsSync(join(dir, rel)), false, `dry-run 不得落盘：${rel}`)
    }

    // --write：产出四件 + 关键行
    const w1 = runInit('pwa', dir, ['--write'])
    assert.equal(w1.code, 0, w1.out)
    assert.match(w1.out, /写入：sw\.config\.mjs/)
    assert.match(w1.out, /写入：scripts\/gen-sw\.mjs/)
    assert.match(w1.out, /写入：Dockerfile\.pwa-snippet/)
    assert.match(w1.out, /写入：next\.config\.pwa-snippet\.mjs/)
    const cfg = readFileSync(join(dir, 'sw.config.mjs'), 'utf8')
    assert.match(cfg, /version: process\.env\.SW_VERSION/)
    assert.match(cfg, /match: '\/_next\/static\/'/)
    const snippet = readFileSync(join(dir, 'Dockerfile.pwa-snippet'), 'utf8')
    assert.match(snippet, /test -n "\$SW_VERSION"/)
    assert.match(snippet, /node scripts\/gen-sw\.mjs/)
    assert.match(snippet, /COPY --from=builder[^\n]*public[^\n]*\.\/public/)
    // TOOL-3/DEF-4：next.config 片段示范 withPwaKit（/sw.js no-cache 单源）
    const nextSnip = readFileSync(join(dir, 'next.config.pwa-snippet.mjs'), 'utf8')
    assert.match(nextSnip, /@hxym18\/pwa-kit\/next/)
    assert.match(nextSnip, /withPwaKit\s*\(/)
    assert.match(nextSnip, /no-cache/)

    // 二次运行：跳过已存在，内容不变（幂等）
    const before = {
      cfg: readFileSync(join(dir, 'sw.config.mjs'), 'utf8'),
      gen: readFileSync(join(dir, 'scripts/gen-sw.mjs'), 'utf8'),
      snip: readFileSync(join(dir, 'Dockerfile.pwa-snippet'), 'utf8'),
      nextSnip: readFileSync(join(dir, 'next.config.pwa-snippet.mjs'), 'utf8'),
    }
    const w2 = runInit('pwa', dir, ['--write'])
    assert.equal(w2.code, 0, w2.out)
    assert.match(w2.out, /跳过（已存在）：sw\.config\.mjs/)
    assert.equal(readFileSync(join(dir, 'sw.config.mjs'), 'utf8'), before.cfg)
    assert.equal(readFileSync(join(dir, 'scripts/gen-sw.mjs'), 'utf8'), before.gen)
    assert.equal(readFileSync(join(dir, 'Dockerfile.pwa-snippet'), 'utf8'), before.snip)
    assert.equal(readFileSync(join(dir, 'next.config.pwa-snippet.mjs'), 'utf8'), before.nextSnip)
    assert.match(w2.out, /写入 0 个文件/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('init db：dry-run 不落盘；--write 产出 db/migrations + 迁移调用点；二次运行幂等', () => {
  const dir = tmp()
  try {
    const dry = runInit('db', dir)
    assert.equal(dry.code, 0, dry.out)
    assert.equal(existsSync(join(dir, 'server/src/db.ts')), false, 'dry-run 不得落盘')

    const w1 = runInit('db', dir, ['--write'])
    assert.equal(w1.code, 0, w1.out)
    const db = readFileSync(join(dir, 'server/src/db.ts'), 'utf8')
    assert.match(db, /journal_mode = WAL/)
    assert.match(db, /foreign_keys = ON/)
    assert.match(db, /import \{ migrate \} from '\.\/migrations'/) // 迁移调用点
    assert.match(db, /migrate\(db\)/)
    const mig = readFileSync(join(dir, 'server/src/migrations.ts'), 'utf8')
    assert.match(mig, /user_version/)

    const before = db
    const w2 = runInit('db', dir, ['--write'])
    assert.equal(w2.code, 0, w2.out)
    assert.match(w2.out, /跳过（已存在）：server\/src\/db\.ts/)
    assert.equal(readFileSync(join(dir, 'server/src/db.ts'), 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('init stats：dry-run 不落盘；--write 产出 route + lib；关键行（x-ops-token/503/403/no-store）；二次运行幂等', () => {
  const dir = tmp()
  try {
    mkdirSync(join(dir, 'src/app'), { recursive: true }) // 触发 srcDir='src'

    const dry = runInit('stats', dir)
    assert.equal(dry.code, 0, dry.out)
    assert.equal(existsSync(join(dir, 'src/app/api/ops/stats/route.ts')), false, 'dry-run 不得落盘')

    const w1 = runInit('stats', dir, ['--write'])
    assert.equal(w1.code, 0, w1.out)
    const route = readFileSync(join(dir, 'src/app/api/ops/stats/route.ts'), 'utf8')
    assert.match(route, /x-ops-token/)
    assert.match(route, /OPS_STATS_TOKEN/)
    assert.match(route, /timingSafeEqual/)
    assert.match(route, /status: 503/)
    assert.match(route, /status: 403/)
    assert.match(route, /'Cache-Control': 'no-store'/)
    const lib = readFileSync(join(dir, 'src/lib/ops-stats.ts'), 'utf8')
    assert.match(lib, /export function buildOpsStats/)
    assert.match(lib, /OPS_WINDOWS/)

    const before = route
    const w2 = runInit('stats', dir, ['--write'])
    assert.equal(w2.code, 0, w2.out)
    assert.match(w2.out, /跳过（已存在）：src\/app\/api\/ops\/stats\/route\.ts/)
    assert.equal(readFileSync(join(dir, 'src/app/api/ops/stats/route.ts'), 'utf8'), before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
