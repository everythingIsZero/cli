# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **`hxym18 check` 站点接入兜底断言（T17b）**：新增 `src/assertions.mjs`（纯函数）并接入站点级 check。全部**默认 advisory**（打印 ⚠，`exit=0`），`--strict` 才 `exit=1`——**不改默认行为，存量绿站不会突然失败**。覆盖 TOOL-1/2/3/4/5（PWA 构建链·镜像·`/sw.js` 头·manifest·`.gitignore`）、TOOL-6/7/8（`resolveIdentity` 占位·Hono catch-all 末位·`AUTH_INTERNAL_URL` 陈旧值）、TOOL-9（analytics 版本 ≥ 门控修复版 + 禁硬编码 `u.hxym18.com`）、TOOL-11（禁手写 UA）、TOOL-12/13（db 骨架·stats 出口结果校验）、TOOL-15（未接站「应接什么」）、§4③（禁硬编码 `SSO_AUTH_BASE`、禁自写 `consumeReturn`/轮询）。TOOL-15 跨全仓 `package.json` 取并集，monorepo 根也成立。
- `init pwa` 增 `next.config.pwa-snippet.mjs`：示范用 `withPwaKit`（`@hxym18/pwa-kit/next`）包 nextConfig 外层，注入 `/sw.js` no-cache（TOOL-3/DEF-4 的生成器侧消除）。

### Changed

- `check --baseline` 判**方向**（TOOL-14）：不一致时区分「站点落后」（应升级站点）与「基线陈旧」（站点已领先，应更新 `baseline.json`）。新增纯函数 `baselineDeviations`/`baselineDirection`；`checkBaseline` 既有返回形状不变。
- `gen contracts` 的 `analytics-policy` 纳入 `DEFAULT_DENY_HASH_KEYS`（hash 路由门控 key，原只取 deny 前缀/query/noindex）；生成器顺带**清理旧版本孤儿产物**（值改即文件名变，不清理会留「多出未声明副本」/L0 同名多份）。

### Fixed

- **TOOL-12 误报**（`--strict` 误伤存量站）：迁移调用点判据由字面 `migrate(` 放宽为「`migrate` 前缀函数调用 / 幂等 `ALTER TABLE` / `user_version`」，认内联 `db.exec(DDL)` + 幂等 `ALTER` + `migrateLegacyRows(db,…)` 形态（wordinput/fang）。
- **TOOL-4/B6 假阴**：`apple-touch-icon` 判定改为**只认代码行**（按行过滤注释，复用 `CODE_COMMENT_RE`）——注释里写 `apple:` 不再误判为已接。

## [0.9.1] - 2026-10-16

### Fixed

- **TOOL-7 改为「剥注释后再判」（P-11 的完善）**：0.9.0 只用行首锚定的 `CODE_COMMENT_RE` 过滤注释行，仍有两处错——①`/* last */ authRoutes.all('/api/auth/*', …)` 这种**行内块注释前缀**会把真锚点整行跳过 → 其后站点端点**漏报**（0.9.0 引入的假阴）；②**跨行块注释**里的注册行被当锚点 → 误报。现在锚点与端点都在**逐行剥掉注释（含跨行、且认引号内的 `/*`）**的文本上判，两个方向都消掉。前一版「补一行过滤」的修法已被此替代。
- **`--baseline` 形状校验（P-8 残余）**：解析成功但**不是基线形状**（如指到 `package.json`、`123`）时 `baselineDeviations` 因无 `packages` 返 `[]` → 门禁照旧静默通过。现要求 `packages` 为非空对象，否则 `exit≠0` 并提示期望形状。

## [0.9.0] - 2026-10-16

### Fixed

- **`--baseline` 门禁不再静默失效（P-8）**：基线文件**不存在**（路径相对 **cwd** 解析，写错是常见坑）或**解析失败**（半截 JSON / 指错文件）原先只打一行 `hxym18: …` 就继续走完并 `exit 0`——门禁形同没有。现在两者一律 `exit≠0`（与 `--strict` 无关），并提示「不打算比基线就去掉 `--baseline`」。
- **TOOL-7 注释行不再被当作 catch-all 锚点（P-11）**：`honoCatchAllOrderProblems` 的 `findIndex` 漏滤注释行，于是注释里写一句 `authRoutes.all('/api/auth/*', …)` 就会把**注册在真实 catch-all 之前**的站点端点误报成「在通配之后」。现与同函数循环体同口径使用 `CODE_COMMENT_RE`；真「站点端点在 catch-all 之后」仍报。

### Changed

- ⚠️ **P-8 会打断依赖「路径写错也 exit 0」的 CI**：这正是修复目的；请核对各站/CI 里 `--baseline` 的路径（相对 cwd）。

## [0.8.1] - 2026-10-16

### Fixed

- **TOOL-1 取证收窄回构建链（代码复核发现）**：0.8.0 取**全部** `scripts.*` 会漏判——站点把 `gen-sw` 当独立助手在跑（如 `gen:sw`）、构建链根本没调时不再算通过。现只认 `build` / `prebuild` / `postbuild` 及其 `:` 变体（`build:h5` 等仍认）：覆盖真实形态（Taro 站挂 `build:h5`）又不放水。
- **`gen-sw` 匹配放宽**：`/gen-sw\.mjs/` → `/gen-sw(\.mjs)?\b/`，`node scripts/gen-sw`（无扩展名 / 改 `.ts`）同样认。

## [0.8.0] - 2026-10-16

### Fixed

- **PWA 断言误报（P-4）**：
  1. **TOOL-1** 只认 `scripts.build` → 改认**全部** `scripts.*`。Taro 站的 SW 生成挂在 `build:h5` / `dev:h5` / `verify` 上，原先被误判「构建期未调 gen-sw」。
  2. **TOOL-3** 只扫给定目录 → Hono 装配文件取「站点目录 **+ 仓库根 `server/`**」并集。前后端分仓站点（站点在 `apps/<x>`、后端在仓库根 `server/`）的 `/sw.js` no-cache 头在服务端，原先被误判「无 no-cache 头」。
  3. **TOOL-5** 只读扫描目录内 `.gitignore` → 改**先问 `git check-ignore`**（仓库根的 `.gitignore` 也生效，monorepo 的 `apps/<x>/public/sw.js` 记在根 `.gitignore` 里同样认得出；非 git 仓 / git 不可用才回落文本扫描）。
  4. **TOOL-4/B6** 只看 layout 代码 → 站内已有图标**文件**（`public/apple-touch-icon*`、Next app 目录 `apple-icon.*`）也算通过——iOS 在无 link 标签时会自动请求 `/apple-touch-icon.png`，图标其实不缺。

  判定未见放宽：负例（真没调 gen-sw / 真未忽略 / 真无图标文件）仍报。

### Changed

- `gitignoreSwProblems({ gitignores, ignoredByGit })`、`manifestProblems({ manifests, layouts, appleIconFiles })` 新增可选入参；缺省与既有调用行为不变。

## [0.7.0] - 2026-10-12

### Added

- **`hxym18 init pwa` 补 Dockerfile 片段**：新增 `Dockerfile.pwa-snippet`（**两段**——构建期 `test -n "$SW_VERSION"` 校验 + `node scripts/gen-sw.mjs`；运行镜像 `COPY --from=builder ... public ./public`），消 TOOL-1/2、DEF-5 的手工复制。`sw.config.mjs` 保持默认读 `SW_VERSION` + 默认 `/_next/static/` cache-first（DEF-1/2）。
- **`hxym18 init stats` 改为生成器**（原只打印清单）：产出 `<src>/lib/ops-stats.ts`（`buildOpsStats` 取数骨架，缺项 = null）+ `<src>/app/api/ops/stats/route.ts`（只读出口，头 `x-ops-token` == `OPS_STATS_TOKEN`；未配置 → 503、不匹配 → 403、定长比较；`Cache-Control: no-store`）——TOOL-13。默认 dry-run、`--write` 落盘、幂等。
- **`init db` 骨架补迁移调用点**：生成的 `db.ts` 在 `getDb()` 内 `import { migrate } from './migrations'` 并调用（首次建连接即应用未执行迁移）——TOOL-12。

### Changed

- 脚手架 `templates/project-scaffold/` 增 `.gitignore`（含 `public/sw.js`；DEF-6）。

### Fixed

- 测试改用 `process.execPath` 派生 `check` 子进程，不再依赖 PATH 上有 `node`（此前 `node` 不在 PATH 时整个 check/generators 套件假失败）。

## [0.6.0] - 2026-10-11

### Added

- **`hxym18 gen contracts`**：从各包**源码**读取常量，生成 L0 契约（`knowledge/integration/contracts/`，8 份 + `contracts@<ver>+<sha8>` 集版本身份）、各包内**契约副本**（带内容哈希）与 `package.json` 的 `hxym18.contracts` 声明；默认 dry-run、`--write` 落盘、幂等。`endpoints` 会交叉核对 `CORE_AUTH_ENDPOINTS` 与 auth 的 `dispatch`，不一致即报错。
- **`hxym18 check <pkg> --contracts <L0>`（包级层，spec §7）**：声明↔副本一一对应、副本内容哈希与文件名一致、副本与 L0 **逐字节相同**、端点完整性；任一不过 **exit 1**。站点级 `check` 行为不变。

### Fixed

- `check` 的 PWA 判定补「`scripts/gen-sw.mjs` 必须 import `@hxym18/pwa-kit/sw`」：此前只看文件存在，自写死 SW 的站点也能过（读文件失败即视为有问题，不静默通过）。

### Chore

- 包内**契约副本**声明（`hxym18.contracts`）：`endpoints@1`。

## [0.5.2] - 2026-10-11

### Changed

- `init auth` **不再生成 `config` 路由**（端点单源，改由共享核心 `@hxym18/auth` 提供）；Taro/Hono 适配改为 `authRoutes.all('/api/auth/*', routes.dispatch)` **catch-all 末位**（站点自有 `/api/auth/*` 须先注册）。

### Added

- `check` 扫描**自写 core 端点**：命中 `config`/`dev-login`/`sso-verify`/`wx-qrcode`/`wx-poll`/`weapp`/`logout` 的**路由文件或路由定义行**即 `exit≠0`（端点单源）；**排除注释行与测试文件**（`/test(s)/`、`.test.`、`.spec.`），业务端点与 `[action]` 通配不报。

## [0.5.1] - 2026-10-11

### Fixed

- `init pwa` 生成的 `sw.config.mjs` / `scripts/gen-sw.mjs` 去掉 `|| 'dev'` 兜底：`SW_VERSION` 为空即由 `buildSw` 构建报错，不再静默写死 `dev` 版本。

## [0.5.0] - 2026-10-11

### Added

- `init pwa`：生成 `sw.config.mjs` + `scripts/gen-sw.mjs`（构建期从 `@hxym18/pwa-kit/sw` 生成 `public/sw.js`，`sw.js` 不提交）。
- `check` 的 pwa 判定：站点声明 `@hxym18/pwa-kit` 即触发（不得提交 `sw.js`、生成脚本存在且 import `@hxym18/pwa-kit/sw`、tag 锁版），默认 advisory，`--strict` 视为失败。

## [0.4.0] - 2026-10-11

### Changed

- `init auth --target taro` 生成的客户端接线改用 `@hxym18/auth/core` 的 `loginCapsFromCapabilities()` 投影
  env 能力位（此前整体透传 `capabilities()`，会把桌面微信送进 OAuth 死路），并去掉手传的 `isH5`
  （终端改由「有无 window」判定）。**生成的接线要求 `@hxym18/auth ≥ v0.7.0`。**

## [0.3.3] - 2026-10-10

### Fixed

- `check` 死依赖扫描：单个包 `grep` 非「无匹配（exit 1）」的异常，按「已出现」处理，避免误报死依赖（对齐旧语义）。

## [0.3.2] - 2026-10-10

### Changed

- `check` 死依赖判定抽为纯函数 `unusedShared`（`core`），bin 复用。

### Added

- `check` **端到端测试**（真跑 bin：死依赖 / 未锁版 → `exit≠0`；正常 → `exit=0`）——门禁可失败有据。

## [0.3.1] - 2026-10-10

### Docs

- README/bin 说明同步（`check` 含「死依赖」检测）。

## [0.3.0] - 2026-10-10

### Added

- `check` 加「**声明了可导入的 `@hxym18/*` 却未 import**」检测（死依赖 → `exit≠0`）——堵住「声明了共享包却没用」的漏网（如 nuantie 的 env）。

## [0.2.0] - 2026-10-10

### Added

- `init auth --target next|taro`：新增 **Taro** 目标，生成**客户端 `src/lib/sso-login.ts`（H5 `createTaroLogin`+`createTaroApi`、小程序 `createWeappLogin`）+ Hono 服务端 `server/src/auth.ts`（`createHonoAuthRoutes`，weapp 走核心 `weappVerify`）**，H5 与 Next 对等、小程序端登录走共享核心；缺省按项目特征**自动探测**，判定不出/两者皆中 → `exit=1`——不再对非 Next 目录静默写错文件。
- 核心纯函数 `taroAuthScaffold` / `depsForCheck`。

### Changed

- `init auth` / `init db` 的 `--dir` 统一为**项目根**；`init db` 固定落 `<根>/server/src/`（原 `init db --dir` 语义是「直接目标目录」，与 `init auth` 不一致）。

### Fixed

- `check` 改扫 `dependencies + devDependencies + peerDependencies`：放 devDependencies 的未锁版共享包此前能逃过门禁。
- `check` 旧包名残留扫描：`grep` 不可用/异常时视为**失败**（原 `catch` 把一切错误当「无匹配」，会静默通过）。

## [0.1.4] - 2026-10-08

### Added

- `hxym18 init db [--write] [--dir]`：生成后端数据层骨架（`db.ts` WAL/foreign_keys 禁 DDL + `migrations.ts` 版本化迁移）；核心 `dbScaffold`。
- `hxym18 init stats`：打印业务统计只读出口接入清单。

## [0.1.3] - 2026-10-08

### Fixed

- `check` 旧包名残留扫描改为全仓（排除 node_modules/.next/.git/dist），修复无 `src` 目录的项目漏扫。

## [0.1.2] - 2026-10-08

### Added

- `check --baseline <file>`：与版本基线（`knowledge/integration/baseline.json`）比对共享包版本，默认 advisory，`--strict` 视为失败；核心 `checkBaseline`。

## [0.1.1] - 2026-10-08

### Added

- `hxym18 init auth --write`：真正生成接入文件（`lib/auth-routes.ts` / `app/api/auth/[action]/route.ts` / `config/route.ts`），幂等（已存在跳过）；核心 `authScaffold`。

## [0.1.0] - 2026-10-08

### Added

- `hxym18 list`：列出已知共享包。
- `hxym18 add <repo> [--write] [--dir]`：解析最新 tag，产出/写入 tag 锁版依赖。
- `hxym18 check [dir]`：校验 `@hxym18/*` 依赖 tag 锁版与旧包名（`@app/auth`）残留，可失败。
- `hxym18 init auth`：打印 auth 接入清单。
- 核心纯函数 `pinSpec` / `isTagPin` / `findPinProblems` / `findLegacyRefs`。
