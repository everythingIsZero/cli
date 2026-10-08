export const KNOWN_PACKAGES: Readonly<Record<string, string>>
export const LEGACY_AUTH_PACKAGE: string

export function pinSpec(repo: string, tag: string): string
export function isTagPin(spec: unknown): boolean
export function findPinProblems(deps: Record<string, string>): { name: string; spec: string }[]
export function findLegacyRefs(text: unknown): string[]
export function authScaffold(opts?: { srcDir?: string }): { path: string; content: string }[]
