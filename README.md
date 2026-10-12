# @hxym18/cli

共享包接入 CLI。把「怎么引用共享包」从「看别的项目怎么接」变成一条命令 + 一处规范：
统一 `github:everythingIsZero/<repo>#v<semver>` **tag 锁版**，禁止手写版本、禁止分支引用。

## 安装 / 运行

```bash
# 一次性
pnpm dlx github:everythingIsZero/cli#v0.6.0 <cmd>
# 或本地安装
pnpm add -D github:everythingIsZero/cli#v0.6.0
npx hxym18 <cmd>
```

## 命令

| 命令 | 作用 |
|---|---|
| `hxym18 list` | 列出已知共享包与消费串形态 |
| `hxym18 add <repo> [--write] [--dir <dir>]` | 解析该仓**最新 tag**，产出并（`--write`）写入锁定依赖；默认 dry-run |
| `hxym18 check [dir] [--baseline <file>] [--strict]` | 校验：`@hxym18/*` 依赖（**dependencies + devDependencies + peerDependencies**）是否 tag 锁版、旧包名残留（**全仓扫代码文件**）、**声明了却未 import 的死依赖**、是否与版本基线一致。**有问题 exit=1**；基线不一致默认只告警，`--strict` 视为失败；旧包残留扫描若 `grep` 不可用 → 视为失败（不静默通过）；PWA 接入（**声明 `@hxym18/pwa-kit` 即触发**）另校验：未提交 `public/sw.js`、存在 `scripts/gen-sw.mjs` **且其 import `@hxym18/pwa-kit/sw`**（自写死 SW 即报问题）、pwa-kit tag 锁版；默认 advisory（⚠，`exit=0`），`--strict` 视为失败；**自写 auth core 端点**（`config`/`dev-login`/`sso-verify`/`wx-qrcode`/`wx-poll`/`weapp`/`logout` 的**路由文件或路由定义行**）→ 失败（端点单源，I5/I14） |
| `hxym18 check <包目录> --contracts <L0 目录>` | **包级契约校验**（spec §7；非 advisory，任一项不过 `exit=1`）：① `hxym18.contracts` 声明与 `contracts/` 副本一一对应；② 副本内容哈希 == 文件名 `sha8`；③ 副本 == L0（逐字节）；④ 端点完整性（L0 `endpoints` == 该包端点定义，**仅 auth/cli**）；⑤ 敏感前缀副本齐全（仅声明了该契约的包）。**无 `--contracts` 且包未声明 `hxym18.contracts` 时走上面的站点级校验**（站点行为不变）；包已声明则自动探测 `../../knowledge/integration/contracts` 为 L0 |
| `hxym18 gen contracts [--root <工作区根>] [--l0 <L0 目录>] [--write]` | **契约副本生成器**（spec §5）：从各包源码**读常量**构造 8 份契约（`sensitive-prefixes`/`endpoints`/`cache-policy`/`share-url-policy`/`analytics-policy`/`capability-projection`/`facade`/`contracts`），写 L0（`knowledge/integration/contracts/<name>@1+<sha8>.json`）+ 各消费包内联副本（**逐字节相同**）+ 更新各包 `package.json` 的 `hxym18.contracts` 声明。默认 **dry-run**（只打印将写入的文件），`--write` 落盘；**幂等**。`endpoints` 要求 `CORE_AUTH_ENDPOINTS` 与 auth `dispatch` 分支一致，不一致即报错 |
| `hxym18 init auth [--target next\|taro] [--write] [--dir <项目根>]` | 生成 auth 接入文件（**只生成「挂载 + `resolveIdentity`」**）。缺省**自动探测**项目类型；Next → `lib/auth-routes.ts` + `app/api/auth/[action]/route.ts`（`[action]` 通配把 `/api/auth/*` 全量交给共享核心，**不再生成 config 路由**；端点单源，避免自写端点漂移）；Taro → 客户端 `src/lib/sso-login.ts`（无 `src/` 时落 `lib/sso-login.ts`；H5 `createTaroLogin`+`createTaroApi`、小程序 `createWeappLogin`）**+ Hono 服务端 `server/src/auth.ts`**（`createHonoAuthRoutes`；`authRoutes.all('/api/auth/*', routes.dispatch)` **catch-all 末位**，站点自有 `/api/auth/*` 须先注册；站点只补 `resolveIdentity`）。判定不出/两者皆中 → `exit=1`（须显式 `--target`）。默认 dry-run，`--write` 落盘且**幂等**（已存在则跳过） |
| `hxym18 init db [--write] [--dir <项目根>]` | 生成后端数据层骨架（Hono + better-sqlite3 + 版本化迁移）：`<根>/server/src/db.ts`（WAL/foreign_keys，禁 DDL，**`getDb()` 内调 `migrate()` = 迁移调用点**）+ `migrations.ts`（`PRAGMA user_version`）。默认 dry-run，`--write` 落盘且**幂等** |
| `hxym18 init pwa [--write] [--dir <站点根>]` | 生成 PWA 接入文件（**站点根相对路径**）：`sw.config.mjs`（`version` 默认读 `SW_VERSION`——构建期注入，如部署主机 git SHA；**为空则构建报错**，不兜默认；默认含 `/_next/static/` cache-first 规则）+ `scripts/gen-sw.mjs`（构建期 `import { buildSw } from '@hxym18/pwa-kit/sw'` 生成 `public/sw.js`，`--stdout` 打印）+ `Dockerfile.pwa-snippet`（**两段**：构建期 `test -n "$SW_VERSION"` 校验 + 跑 gen-sw；运行镜像 `COPY ... public ./public`——TOOL-1/2/DEF-5）。`sw.js` 是构建产出，**不提交**（`.gitignore`）。默认 dry-run，`--write` 落盘且**幂等**。CLI 不 import pwa-kit、不重复策略逻辑 |
| `hxym18 init stats [--write] [--dir <站点根>]` | 生成业务统计**只读出口**（Next App Router，TOOL-13）：`<src>/lib/ops-stats.ts`（`buildOpsStats` 取数骨架，本站补 SQL；**缺项 = null**，不得填 0）+ `<src>/app/api/ops/stats/route.ts`（头 `x-ops-token` == env `OPS_STATS_TOKEN`，**未配置 → 503、不匹配 → 403**，定长比较；`?days=1\|7\|30`；`Cache-Control: no-store`）。`--dir` 为站点根；`src/app` 存在则落 `src/` 否则落根。默认 dry-run，`--write` 落盘且**幂等** |

示例：

```bash
hxym18 add auth --write --dir apps/fang   # 写入 package.json 后自行 pnpm install
hxym18 init auth --write --dir apps/fang          # 自动探测 → Next 路由文件（幂等）
hxym18 init auth --target taro --write --dir apps/client   # Taro → 客户端 src/lib/sso-login.ts + Hono 服务端 server/src/auth.ts
hxym18 init db --write --dir apps/fang            # 落 apps/fang/server/src/db.ts + migrations.ts（含 migrate() 调用点）
hxym18 init pwa --write --dir apps/wordinput      # 落 sw.config.mjs + scripts/gen-sw.mjs + Dockerfile.pwa-snippet（站点根相对）
hxym18 init stats --write --dir apps/fang         # 落 src/lib/ops-stats.ts + src/app/api/ops/stats/route.ts（只读出口）
hxym18 check apps/fang                     # CI/本地门禁：未锁定或旧包残留即失败
hxym18 check apps/fang --baseline ../../knowledge/integration/baseline.json   # 版本基线比对（advisory）
hxym18 gen contracts --root ../..                     # dry-run：列出将写入的 8 份契约 + 各包副本
hxym18 gen contracts --root ../.. --write             # 落 L0 + 各包 contracts/ 副本 + package.json 声明
hxym18 check Projects/auth --contracts knowledge/integration/contracts   # 包级契约校验（exit 1 即漂移）
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
- `init pwa` 的 `--dir` 为**站点根**；产出 `sw.config.mjs` + `scripts/gen-sw.mjs` + `Dockerfile.pwa-snippet`（站点根相对路径，与 `auth`/`db` 同约定）。`SW_VERSION` 为构建期显式输入（如部署主机 git SHA）；**为空则构建报错**（`buildSw` 抛错，不兜默认）；生成的 `public/sw.js` **不提交**（`.gitignore`），故无「已提交副本」漂移。`Dockerfile.pwa-snippet` 是**两段**可合入的 Dockerfile 片段（构建期校验 + gen-sw；运行镜像 `COPY public`）——`check` 的 TOOL-1/2 兜底断言在 T17b，生成器只为消除手工复制。
- `init stats` 的 `--dir` 为**站点根**，产物为 Next App Router（`<src>/lib/ops-stats.ts` + `<src>/app/api/ops/stats/route.ts`）；**Taro/Hono 变体未生成**（如需请手写，参考 fang 实现）。
- `check` 扫 **dependencies + devDependencies + peerDependencies**（放 devDeps 的未锁版不再漏检）；旧包残留扫描若 `grep` 不可用 → 视为失败；**声明了可导入的 `@hxym18/*` 却未 import（死依赖）→ 失败**。
- **包级 vs 站点级**：`check <站点目录>`（无 `--contracts`、包内无 `hxym18.contracts`）仍是上面的站点级校验；`check <包目录> --contracts <L0>` 走**包级契约校验**（spec §7，非 advisory）。包若已声明 `hxym18.contracts`，省略 `--contracts` 时自动探测 `../../knowledge/integration/contracts` 作 L0。
- `gen contracts`：契约**单源 + 内联 + 哈希**（spec §0/§5）。L0 在 `knowledge/integration/contracts/`；各包内联副本禁手改，文件名带内容哈希；包内声明所据版本（`package.json` 的 `hxym18.contracts`）。**check 不依赖生成器**——包仓凭「声明 + 哈希」独立自校验。契约取值一律从各包源码常量读取，不手抄（值改即哈希变、文件名变）。
- `gen contracts` 需在**工作区**运行（动态 import 各包源码）；`endpoints` 契约要求 `@hxym18/cli` 的 `CORE_AUTH_ENDPOINTS` 与 `@hxym18/auth` 的 `dispatch` 分支一致，不一致即生成报错。
- `check` 站点级扫描**自写 auth core 端点**：**只认路由定义**——Next 路由文件路径（`**/api/auth/<core>/route.{ts,js,tsx,jsx,mjs}`）或路由定义行（`.get|.post|.put|.delete|.all|.use|.route(` 紧跟引号内 `/api/auth/<core>`）。命中 `config`/`dev-login`/`sso-verify`/`wx-qrcode`/`wx-poll`/`weapp`/`logout` 即 `exit≠0`（core 端点由 `@hxym18/auth` 单源提供；站点只留「挂载 + `resolveIdentity` + 业务端点」）。**排除注释行与测试文件**（`/test(s)/`、`.test.`、`.spec.`）；业务端点（如 `me`/`session`/`device`）与 `[action]` 通配不报。
