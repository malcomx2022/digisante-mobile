export const SMOKE_PROVIDERS: { flag: string; file: string }[];
export function selectedSmokeFiles(env: Record<string, string | undefined>): string[];
export function smokeEnvironmentIssues(env: Record<string, string | undefined>, actualSha: string): string[];
export function assertFedapaySandbox(input: { enabled: boolean; secrets: Record<string, string | undefined> }): void;
export function requestFedapaySandbox(secrets: Record<string, string | undefined>, request?: typeof fetch): Promise<Response>;
