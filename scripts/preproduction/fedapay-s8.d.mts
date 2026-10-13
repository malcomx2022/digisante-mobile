export type S8Code =
  | 'HOTE_AUTORISE' | 'HOTE_LIVE' | 'HOTE_NON_LISTE' | 'FORME_REFUSEE'
  | 'URL_INVALIDE' | 'CREATION_HTTP' | 'ID_INVALIDE' | 'TOKEN_HTTP';
export interface S8UrlShape {
  valid: boolean;
  protocol?: string; host?: string; port?: string | null; credentials?: boolean;
  path?: string; queryParams?: number; fragment?: boolean;
}
export interface S8Result {
  verdict: 'PASS' | 'FAIL';
  code: S8Code;
  shape?: S8UrlShape;
  transaction?: string;
  createStatus?: number; createFields?: string[];
  tokenStatus?: number; tokenFields?: string[];
}
export interface S8Hosts { live: readonly string[]; sandbox: readonly string[] }
export const SANDBOX_API: string;
export const S8_AMOUNT_XOF: number;
export const S8_DECISIONS: Readonly<Record<S8Code, string>>;
export function describeCheckoutUrl(value: unknown): S8UrlShape;
export function s8Verdict(url: unknown, opts: { isAllowedSandbox: (url: unknown) => boolean; hosts: S8Hosts }): S8Result;
export function runS8Probe(opts: {
  enabled: boolean;
  secrets: Record<string, string | undefined>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  parseId: (value: unknown) => string | null;
  isAllowedSandbox: (url: unknown) => boolean;
  hosts: S8Hosts;
  reference: string;
}): Promise<S8Result>;
export function formatS8(result: S8Result, reference: string): string[];
