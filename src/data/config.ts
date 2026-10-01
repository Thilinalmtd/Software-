// Where the app keeps its connection details (per Windows user, in the app's local storage).

export interface Connection {
  url: string;
  anonKey: string;
}

export type AppMode = 'supabase' | 'demo';

const CONNECTION_KEY = 'aptocad-finance-connection';
const MODE_KEY = 'aptocad-finance-mode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Build-time defaults (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) let IT ship a pre-configured installer. */
function envConnection(): Connection | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const base = url ? normaliseSupabaseUrl(url) : null;
  return base && anonKey ? { url: base, anonKey: anonKey.trim() } : null;
}

export function getConnection(): Connection | null {
  const raw = read(CONNECTION_KEY);
  if (raw) {
    try {
      const c = JSON.parse(raw) as Connection;
      // Normalised on read too, so a URL saved by an older version (e.g. ending in /rest/v1) heals itself.
      const base = c.url ? normaliseSupabaseUrl(c.url) : null;
      if (base && c.anonKey) return { url: base, anonKey: c.anonKey };
    } catch {
      /* ignore */
    }
  }
  return envConnection();
}

export function saveConnection(c: Connection): void {
  write(CONNECTION_KEY, JSON.stringify({ url: normaliseSupabaseUrl(c.url) ?? c.url.trim(), anonKey: c.anonKey.trim() }));
}

export function clearConnection(): void {
  write(CONNECTION_KEY, null);
}

export function getMode(): AppMode | null {
  const m = read(MODE_KEY);
  if (m === 'supabase' || m === 'demo') return m;
  return envConnection() ? 'supabase' : null;
}

export function setMode(mode: AppMode | null): void {
  write(MODE_KEY, mode);
}

const PROJECT_REF = /^[a-z0-9]{20}$/;

/**
 * Turns whatever was copied from Supabase into the project's base URL (`https://<ref>.supabase.co`).
 * supabase-js appends /auth/v1, /rest/v1 … to this base, so any path left on it (for example the
 * API URL ending in /rest/v1) sends sign-in to the wrong service. Accepts the API URL with any path,
 * the dashboard address (supabase.com/dashboard/project/<ref>), a URL without https://, or the bare
 * project ID. Returns null when it cannot be a Supabase address.
 */
export function normaliseSupabaseUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (PROJECT_REF.test(s)) return `https://${s}.supabase.co`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; // e.g. a postgresql:// connection string
  const host = u.hostname.toLowerCase();
  if (host === 'supabase.com' || host.endsWith('.supabase.com')) {
    const ref = /\/project\/([a-z0-9]{20})(?:\/|$)/.exec(u.pathname)?.[1];
    return ref ? `https://${ref}.supabase.co` : null;
  }
  if (host.endsWith('.supabase.co')) {
    const ref = host.slice(0, -'.supabase.co'.length).replace(/^db\./, ''); // db.<ref> is the database host
    return /^[a-z0-9-]+$/.test(ref) ? `https://${ref}.supabase.co` : null;
  }
  // Self-hosted or custom domain: https only, except a local development stack.
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!local && (u.protocol === 'http:' || !host.includes('.'))) return null;
  return u.origin;
}

export function isValidSupabaseUrl(url: string): boolean {
  return normaliseSupabaseUrl(url) !== null;
}

function jwtPayload(key: string): Record<string, unknown> | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Why this key must not (or cannot) be used, or null when it looks right. */
export function apiKeyProblem(key: string, url?: string | null): string | null {
  const k = key.trim();
  if (!k) return null;
  const secret = 'This is a secret key, which bypasses the security rules. Use the publishable key (sb_publishable_…) instead.';
  if (k.startsWith('sb_secret_')) return secret;
  if (k.startsWith('sb_publishable_')) return null;
  const claims = jwtPayload(k);
  if (claims) {
    if (claims.role === 'service_role') return secret;
    const ref = typeof claims.ref === 'string' ? claims.ref : null;
    const urlRef = url ? /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url)?.[1] : null;
    if (ref && urlRef && ref !== urlRef) return `This key belongs to a different project (${ref}). Copy the key from the same project as the URL.`;
    return null;
  }
  return k.length > 20 ? null : 'That does not look like a complete key — copy it again with the copy button.';
}

/** Asks the project's Auth service for its public settings, to prove the URL and key work before saving them. */
export async function verifyConnection(c: Connection, fetcher: typeof fetch = fetch): Promise<void> {
  const host = new URL(c.url).host;
  let res: Response;
  try {
    res = await fetcher(`${c.url}/auth/v1/settings`, { headers: { apikey: c.anonKey } });
  } catch {
    throw new Error(`Could not reach ${host}. Check the Project URL and that this PC is online.`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Supabase did not accept the key. Copy the publishable key again from Project Settings → API Keys.');
  if (res.status >= 500) throw new Error(`The Supabase project at ${host} is not responding (error ${res.status}). If it was paused, restore it from the Supabase dashboard and try again.`);
  const body: unknown = res.ok ? await res.json().catch(() => null) : null;
  if (!body || typeof body !== 'object' || !('external' in body)) throw new Error(`${host} does not look like a Supabase project. Use the Project URL from Supabase → Connect.`);
}
