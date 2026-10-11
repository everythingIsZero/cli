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
export function pwaDeclared(deps: Record<string, string>): boolean
export function pwaCheckProblems(input: {
  hasCommittedSw: boolean
  genScriptPresent: boolean
  pinned: boolean
}): string[]
export function checkBaseline(
  deps: Record<string, string>,
  baseline: { packages?: Record<string, string> } | null,
): { name: string; expected: string; actual: string }[]
