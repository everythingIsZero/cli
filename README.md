# @hxym18/cli

共享包接入 CLI。把「怎么引用共享包」从「看别的项目怎么接」变成一条命令 + 一处规范：
统一 `github:everythingIsZero/<repo>#v<semver>` **tag 锁版**，禁止手写版本、禁止分支引用。

## 安装 / 运行

```bash
# 一次性
pnpm dlx github:everythingIsZero/cli#v0.1.0 <cmd>
# 或本地安装
pnpm add -D github:everythingIsZero/cli#v0.1.0
npx hxym18 <cmd>
```

## 命令

| 命令 | 作用 |
|---|---|
| `hxym18 list` | 列出已知共享包与消费串形态 |
| `hxym18 add <repo> [--write] [--dir <dir>]` | 解析该仓**最新 tag**，产出并（`--write`）写入锁定依赖；默认 dry-run |
| `hxym18 check [dir]` | 校验：`@hxym18/*` 依赖是否 tag 锁版、src 是否有旧包名残留（`@app/auth`）。**有问题 exit=1** |
| `hxym18 init auth [--write] [--dir <dir>]` | 生成 auth 接入文件（Next App Router：`lib/auth-routes.ts` + `app/api/auth/[action]/route.ts` + `config/route.ts`）；默认 dry-run，`--write` 落盘且**幂等**（已存在则跳过） |

示例：

```bash
hxym18 add auth --write --dir apps/fang   # 写入 package.json 后自行 pnpm install
hxym18 init auth --write --dir apps/fang   # 生成 auth 路由文件（幂等）
hxym18 check apps/fang                     # CI/本地门禁：未锁定或旧包残留即失败
```

`init auth` 生成的 `lib/auth-routes.ts` 里 `resolveIdentity` 是 TODO 占位，需按本站身份库补全；契约与示例见 `knowledge/integration/`。

## 已知共享包

`auth` · `analytics` · `env` · `share-kit` · `pwa-kit`（均 `@hxym18/*`）。

## 说明

- `check` 的判定是**可失败**的：取不到 `package.json` 或发现未锁定/残留即 `exit≠0`，供接入门禁使用。
- `add` 通过 `git ls-remote` 解析最新 semver tag，避免手抄版本漂移。
