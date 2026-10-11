# @hxym18/cli

共享包接入 CLI。把「怎么引用共享包」从「看别的项目怎么接」变成一条命令 + 一处规范：
统一 `github:everythingIsZero/<repo>#v<semver>` **tag 锁版**，禁止手写版本、禁止分支引用。

## 安装 / 运行

```bash
# 一次性
pnpm dlx github:everythingIsZero/cli#v0.3.3 <cmd>
# 或本地安装
pnpm add -D github:everythingIsZero/cli#v0.3.3
npx hxym18 <cmd>
```

## 命令

| 命令 | 作用 |
|---|---|
| `hxym18 list` | 列出已知共享包与消费串形态 |
| `hxym18 add <repo> [--write] [--dir <dir>]` | 解析该仓**最新 tag**，产出并（`--write`）写入锁定依赖；默认 dry-run |
| `hxym18 check [dir] [--baseline <file>] [--strict]` | 校验：`@hxym18/*` 依赖（**dependencies + devDependencies + peerDependencies**）是否 tag 锁版、旧包名残留（**全仓扫代码文件**）、**声明了却未 import 的死依赖**、是否与版本基线一致。**有问题 exit=1**；基线不一致默认只告警，`--strict` 视为失败；旧包残留扫描若 `grep` 不可用 → 视为失败（不静默通过）；PWA 站点（含 `sw.config.mjs` / `scripts/gen-sw.mjs`）另校验：未提交 `public/sw.js`、存在生成脚本、pwa-kit tag 锁版 |
| `hxym18 init auth [--target next\|taro] [--write] [--dir <项目根>]` | 生成 auth 接入文件。缺省**自动探测**项目类型；Next → `lib/auth-routes.ts` + `app/api/auth/[action]/route.ts` + `app/api/auth/config/route.ts`；Taro → 客户端 `src/lib/sso-login.ts`（无 `src/` 时落 `lib/sso-login.ts`；H5 `createTaroLogin`+`createTaroApi`、小程序 `createWeappLogin`）**+ Hono 服务端 `server/src/auth.ts`**（`createHonoAuthRoutes`，weapp 走核心 `weappVerify`；站点只补 `resolveIdentity`）。判定不出/两者皆中 → `exit=1`（须显式 `--target`）。默认 dry-run，`--write` 落盘且**幂等**（已存在则跳过） |
| `hxym18 init db [--write] [--dir <项目根>]` | 生成后端数据层骨架（Hono + better-sqlite3 + 版本化迁移）：`<根>/server/src/db.ts`（WAL/foreign_keys，禁 DDL）+ `migrations.ts`（`PRAGMA user_version`） |
| `hxym18 init pwa [--write] [--dir <站点根>]` | 生成 PWA 接入文件（**站点根相对路径**）：`sw.config.mjs`（`version` 取 `SW_VERSION`，缺省 `'dev'`；SW **默认不缓存**，仅 `rules` 命中路径按策略）+ `scripts/gen-sw.mjs`（构建期 `import { buildSw } from '@hxym18/pwa-kit/sw'` 生成 `public/sw.js`，`--stdout` 打印）。`sw.js` 是构建产出，**不提交**（`.gitignore`）。CLI 不 import pwa-kit、不重复策略逻辑 |
| `hxym18 init stats` | 打印业务统计只读出口（`/api/ops/stats` + `OPS_STATS_TOKEN`）接入清单（含参考实现指针） |

示例：

```bash
hxym18 add auth --write --dir apps/fang   # 写入 package.json 后自行 pnpm install
hxym18 init auth --write --dir apps/fang          # 自动探测 → Next 路由文件（幂等）
hxym18 init auth --target taro --write --dir apps/client   # Taro → 客户端 src/lib/sso-login.ts + Hono 服务端 server/src/auth.ts
hxym18 init db --write --dir apps/fang            # 落 apps/fang/server/src/db.ts + migrations.ts
hxym18 init pwa --write --dir apps/wordinput      # 落 sw.config.mjs + scripts/gen-sw.mjs（站点根相对）
hxym18 check apps/fang                     # CI/本地门禁：未锁定或旧包残留即失败
hxym18 check apps/fang --baseline ../../knowledge/integration/baseline.json   # 版本基线比对（advisory）
```

### 版本基线

`knowledge/integration/baseline.json` 声明共享包的 canonical tag。`check --baseline` 比对，不一致默认只告警（避免硬卡存量），`--strict` 时 `exit=1`（用于新项目/CI 门禁）。

`init auth` 生成的 `lib/auth-routes.ts` 里 `resolveIdentity` 是 TODO 占位，需按本站身份库补全；契约与示例见 `knowledge/integration/`。

## 已知共享包

`auth` · `analytics` · `env` · `share-kit` · `pwa-kit`（均 `@hxym18/*`）。

## 说明

- `check` 的判定是**可失败**的：取不到 `package.json` 或发现未锁定/残留即 `exit≠0`，供接入门禁使用。
- `add` 通过 `git ls-remote` 解析最新 semver tag，避免手抄版本漂移。
- `init auth` 缺省按项目特征自动判定 **Next / Taro**；判定不出或两者皆中 → `exit=1`，须显式 `--target`。**不对非 Next 目录静默写错文件**。
- `--dir` 在 `init auth` / `init db` 统一为**项目根**（db 固定落 `<根>/server/src/`）。
- `init pwa` 的 `--dir` 为**站点根**；产出 `sw.config.mjs` + `scripts/gen-sw.mjs`（站点根相对路径，与 `auth`/`db` 同约定）。`SW_VERSION` 为构建期显式输入（缺省 `'dev'`）；生成的 `public/sw.js` **不提交**（`.gitignore`），故无「已提交副本」漂移。
- `check` 扫 **dependencies + devDependencies + peerDependencies**（放 devDeps 的未锁版不再漏检）；旧包残留扫描若 `grep` 不可用 → 视为失败；**声明了可导入的 `@hxym18/*` 却未 import（死依赖）→ 失败**。
