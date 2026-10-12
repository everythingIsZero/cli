/**
 * check.test.mjs — `hxym18 check` 端到端（真跑 bin，覆盖门禁可失败）
 * 造临时工程 → 跑 check → 断言 exit 码与输出。门禁必须能失败，故这些断言是硬门。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { selfWrittenCoreEndpoints } from '../src/index.mjs'

const BIN = fileURLToPath(new URL('../bin/hxym18.mjs', import.meta.url))

/** 跑 check；返回 { code, out }（非零不抛） */
function runCheck(dir) {
  try {
    const out = execFileSync(process.execPath, [BIN, 'check', dir], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

/** 造临时工程（files: 相对路径 → 内容） */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'hxym18-check-'))
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
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const PINNED_ENV = 'github:everythingIsZero/env#v0.1.1'

test('check：声明了 @hxym18/env 却未 import → exit≠0（死依赖）', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': PINNED_ENV } }),
      'src/a.ts': 'export const x = 1\n',
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 1, '死依赖必须能失败')
      assert.match(r.out, /未 import.*死依赖|声明了但未 import/s)
      assert.match(r.out, /@hxym18\/env/)
    },
  )
})

test('check：声明且 import → exit 0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': PINNED_ENV } }),
      'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})

test('check：未 tag 锁版 → exit≠0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/env': '^0.1.0' } }),
      'src/a.ts': "import { capabilities } from '@hxym18/env'\nexport const x = capabilities\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 1)
      assert.match(r.out, /未 tag 锁版/)
    },
  )
})

test('check：无问题 → exit 0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.6.1' } }),
      'src/a.ts': "import { isTicket } from '@hxym18/auth/core'\nexport const x = isTicket\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})

test('selfWrittenCoreEndpoints：路由文件路径命中 core 端点，业务端点不报', () => {
  const files = [
    'src/app/api/auth/config/route.ts',
    'src/app/api/auth/dev-login/route.ts',
    'src/app/api/auth/me/route.ts',
  ]
  const hits = selfWrittenCoreEndpoints(files)
  assert.ok(hits.some((h) => h.includes('config')))
  assert.ok(hits.some((h) => h.includes('dev-login')))
  assert.ok(!hits.some((h) => h.includes('me'))) // 业务端点不算
})

test('selfWrittenCoreEndpoints：只认路由定义行；注释/测试/业务端点不报', () => {
  const entries = [
    // 真阳性：路由定义行
    "server/src/routes/auth.ts:12:authRoutes.get('/api/auth/config', (c) => routes.config(c))",
    "server/src/routes/auth.ts:13:authRoutes.post('/api/auth/weapp', (c) => routes.weappVerify(c))",
    // 假阳性排除：注释行
    'server/src/services/identity.ts:259:  // 调 /api/auth/config 拿能力位',
    'server/src/services/identity.ts:260: * /api/auth/dev-login 同上',
    // 假阳性排除：测试文件
    "server/tests/weapp-auth.test.ts:35:  await fetch('/api/auth/weapp')",
    // 业务端点
    "server/src/routes/auth.ts:40:authRoutes.post('/api/auth/session', (c) => site(c))",
  ]
  const hits = selfWrittenCoreEndpoints(entries)
  assert.ok(hits.some((h) => h.includes("'/api/auth/config'")))
  assert.ok(hits.some((h) => h.includes("'/api/auth/weapp'")))
  assert.ok(!hits.some((h) => h.includes('identity.ts'))) // 注释不算
  assert.ok(!hits.some((h) => h.includes('weapp-auth.test.ts'))) // 测试不算
  assert.ok(!hits.some((h) => h.includes("'/api/auth/session'"))) // 业务端点不算
})

test('check：自写 core 端点（config）→ exit≠0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.6.1' } }),
      'src/lib/auth-routes.ts': "import { createAuthRoutes } from '@hxym18/auth/next'\nexport const routes = createAuthRoutes({})\n",
      'src/app/api/auth/[action]/route.ts': "import { routes } from '@/lib/auth-routes'\nexport const GET = routes.dispatch\n",
      'src/app/api/auth/config/route.ts': 'export async function GET() { return new Response() }\n',
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 1, '自写 core 端点必须能失败')
      assert.match(r.out, /自写 auth core 端点/)
      assert.match(r.out, /config/)
    },
  )
})

test('check：仅业务端点（me）→ exit 0', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.6.1' } }),
      'src/a.ts': "import { isTicket } from '@hxym18/auth/core'\nexport const x = isTicket\n",
      'src/app/api/auth/me/route.ts': 'export async function GET() { return new Response() }\n',
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})

test('check：注释/测试文件提及 core 端点 → exit 0（不误报）', () => {
  withProject(
    {
      'package.json': JSON.stringify({ dependencies: { '@hxym18/auth': 'github:everythingIsZero/auth#v0.6.1' } }),
      'src/a.ts': "import { isTicket } from '@hxym18/auth/core'\nexport const x = isTicket\n",
      'src/services/identity.ts': '// 调 /api/auth/config 拿能力位\nexport const y = 1\n',
      'server/tests/weapp-auth.test.ts': "test('x', () => fetch('/api/auth/weapp'))\n",
    },
    (dir) => {
      const r = runCheck(dir)
      assert.equal(r.code, 0, r.out)
    },
  )
})
