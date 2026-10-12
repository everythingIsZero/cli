export const KNOWN_PACKAGES: Readonly<Record<string, string>>
export const LEGACY_AUTH_PACKAGE: string

export function pinSpec(repo: string, tag: string): string
export function isTagPin(spec: unknown): boolean
export function findPinProblems(deps: Record<string, string>): { name: string; spec: string }[]
export function findLegacyRefs(text: unknown): string[]
export const CORE_AUTH_ENDPOINTS: readonly string[]
export function selfWrittenCoreEndpoints(files: string[]): string[]
export function depsForCheck(json: unknown): Record<string, string>
export function unusedShared(declared: string[], present: Iterable<string>): string[]
export function authScaffold(opts?: { srcDir?: string }): { path: string; content: string }[]
export function taroAuthScaffold(opts?: { srcDir?: string }): { path: string; content: string }[]
export function dbScaffold(opts?: { dir?: string }): { path: string; content: string }[]
export function pwaScaffold(): { path: string; content: string }[]
export function statsScaffold(opts?: { srcDir?: string }): { path: string; content: string }[]
export function pwaDeclared(deps: Record<string, string>): boolean
export function genScriptImportsPwaKit(content: unknown): boolean
export function pwaCheckProblems(input: {
  hasCommittedSw: boolean
  genScriptPresent: boolean
  genScriptImportsPwaKit?: boolean
  pinned: boolean
}): string[]
export function checkBaseline(
  deps: Record<string, string>,
  baseline: { packages?: Record<string, string> } | null,
): { name: string; expected: string; actual: string }[]

export const CONTRACT_VERSION: number
export const CONTRACT_NAMES: readonly string[]
export const CONTRACT_CONSUMERS: Readonly<Record<string, readonly string[]>>
export const PACKAGE_DIRS: Readonly<Record<string, string>>
export function contractHash(content: unknown): string
export function contractFilename(name: string, version: number, sha8: string): string
export interface ContractEntry {
  name: string
  version: number
  sha8: string
  filename: string
  value: unknown
  content: string
}
export function buildContracts(opts?: { root?: string; version?: number }): Promise<{ version: number; entries: ContractEntry[] }>
export function planContracts(opts?: {
  root?: string
  l0Dir?: string
  packages?: Record<string, string[]>
  version?: number
}): Promise<{
  version: number
  entries: ContractEntry[]
  l0Dir: string
  l0Writes: { path: string; content: string }[]
  copyWrites: { pkg: string; path: string; content: string }[]
  pkgEdits: { pkg: string; path: string; content: string }[]
}>
export function writeContracts(opts?: {
  root?: string
  l0Dir?: string
  packages?: Record<string, string[]>
  version?: number
}): ReturnType<typeof planContracts>
export function packageContractProblems(opts: { pkgDir: string; l0Dir?: string | null }): string[]
export function parseCoreEndpoints(source: string): string[]
export function parseAuthDispatch(source: string): { action: string; method: string }[]
export function responseKeysFromLiteral(literal: string): string[]
export function spreadKeysFromLiteral(literal: string): string[]
