/**
 * core.mjs — 共享包接入 CLI 核心（零依赖纯函数）
 *
 * 目的：把「怎么引用共享包」从「看别的项目怎么接」变成一条命令与一处规范：
 * 统一 `github:everythingIsZero/<repo>#v<semver>` tag 锁版，禁止手写/漂移。
 */

/** 共享包短名 → 包名 */
export const KNOWN_PACKAGES = Object.freeze({
  auth: '@hxym18/auth',
  analytics: '@hxym18/analytics',
  env: '@hxym18/env',
  'share-kit': '@hxym18/share-kit',
  'pwa-kit': '@hxym18/pwa-kit',
})

/** 被 @hxym18/auth 取代的旧包名（check 扫描残留用） */
export const LEGACY_AUTH_PACKAGE = '@app/auth'

/**
 * 产出 tag 锁版依赖串（tag 无 v 前缀则补上）。
 * @param {string} repo 仓库短名（如 'auth'）
 * @param {string} tag 版本（'0.1.1' 或 'v0.1.1'）
 * @returns {string}
 */
export function pinSpec(repo, tag) {
  const t = String(tag == null ? '' : tag).trim()
  const v = /^v/i.test(t) ? t : `v${t}`
  return `github:everythingIsZero/${repo}#${v}`
}

const TAG_PIN_RE = /^github:everythingIsZero\/[a-z0-9-]+#v\d+\.\d+\.\d+$/

/** 是否为规范的 tag 锁版（分支名/范围版本/workspace 均不算） */
export function isTagPin(spec) {
  return typeof spec === 'string' && TAG_PIN_RE.test(spec)
}

/**
 * 找出未 tag 锁版的 @hxym18/* 依赖。
 * @param {Record<string,string>} deps
 * @returns {{ name: string, spec: string }[]}
 */
export function findPinProblems(deps) {
  const out = []
  const d = deps && typeof deps === 'object' ? deps : {}
  for (const [name, spec] of Object.entries(d)) {
    if (name.startsWith('@hxym18/') && !isTagPin(spec)) out.push({ name, spec })
  }
  return out
}

/** 扫描源码里的旧包名残留 */
export function findLegacyRefs(text) {
  const s = typeof text === 'string' ? text : ''
  return s.includes(LEGACY_AUTH_PACKAGE) ? [LEGACY_AUTH_PACKAGE] : []
}
