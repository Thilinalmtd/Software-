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
  return url && anonKey ? { url, anonKey } : null;
}

export function getConnection(): Connection | null {
  const raw = read(CONNECTION_KEY);
  if (raw) {
    try {
      const c = JSON.parse(raw) as Connection;
      if (c.url && c.anonKey) return c;
    } catch {
      /* ignore */
    }
  }
  return envConnection();
}

export function saveConnection(c: Connection): void {
  write(CONNECTION_KEY, JSON.stringify({ url: c.url.trim().replace(/\/+$/, ''), anonKey: c.anonKey.trim() }));
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

export function isValidSupabaseUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
