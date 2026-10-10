# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
