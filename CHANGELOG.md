# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
