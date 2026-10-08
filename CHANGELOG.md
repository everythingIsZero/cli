# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
