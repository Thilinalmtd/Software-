import { describe, expect, it } from 'vitest';
import { apiKeyProblem, normaliseSupabaseUrl, verifyConnection } from './config';

const REF = 'abcdefghijklmnopqrst';
const BASE = `https://${REF}.supabase.co`;

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`;
}

describe('normaliseSupabaseUrl', () => {
  it.each([
    [BASE],
    [`${BASE}/`],
    [`${BASE}/rest/v1/`], // the API URL — this path sent sign-up to the database API ("Invalid path specified in request URL")
    [`${BASE}/auth/v1`],
    [`  ${BASE}/rest/v1  `],
    [`${REF}.supabase.co`],
    [`http://${REF}.supabase.co`],
    [`https://supabase.com/dashboard/project/${REF}`],
    [`https://supabase.com/dashboard/project/${REF}/settings/api-keys`],
    [`https://db.${REF}.supabase.co`],
    [REF],
  ])('%s → the project base URL', (input) => {
    expect(normaliseSupabaseUrl(input)).toBe(BASE);
  });

  it('keeps self-hosted and local addresses, without a path', () => {
    expect(normaliseSupabaseUrl('https://finance.aptocad.lk/rest/v1')).toBe('https://finance.aptocad.lk');
    expect(normaliseSupabaseUrl('http://127.0.0.1:54321/')).toBe('http://127.0.0.1:54321');
    expect(normaliseSupabaseUrl('http://localhost:54321')).toBe('http://localhost:54321');
  });

  it('rejects what cannot be a Project URL', () => {
    expect(normaliseSupabaseUrl('')).toBeNull();
    expect(normaliseSupabaseUrl('http://finance.aptocad.lk')).toBeNull();
    expect(normaliseSupabaseUrl(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`)).toBeNull();
    expect(normaliseSupabaseUrl('https://supabase.com/dashboard/projects')).toBeNull();
    expect(normaliseSupabaseUrl('sb_publishable_abc 123')).toBeNull();
    expect(normaliseSupabaseUrl('sb_publishable_AbCdEf123456')).toBeNull(); // the key pasted in the URL box
  });
});

describe('apiKeyProblem', () => {
  it('accepts publishable and legacy anon keys', () => {
    expect(apiKeyProblem('sb_publishable_AbCdEf123456_xyz', BASE)).toBeNull();
    expect(apiKeyProblem(jwt({ iss: 'supabase', ref: REF, role: 'anon' }), BASE)).toBeNull();
  });

  it('refuses secret and service_role keys', () => {
    expect(apiKeyProblem('sb_secret_AbCdEf123456_xyz', BASE)).toMatch(/secret key/);
    expect(apiKeyProblem(jwt({ iss: 'supabase', ref: REF, role: 'service_role' }), BASE)).toMatch(/secret key/);
  });

  it('spots a key from another project', () => {
    expect(apiKeyProblem(jwt({ ref: 'zzzzzzzzzzzzzzzzzzzz', role: 'anon' }), BASE)).toMatch(/different project/);
  });
});

describe('verifyConnection', () => {
  const c = { url: BASE, anonKey: 'sb_publishable_AbCdEf123456_xyz' };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('passes when the Auth service answers with its settings', async () => {
    let called = '';
    const fetcher = (async (input: string, init: RequestInit) => {
      called = `${input} ${(init.headers as Record<string, string>).apikey}`;
      return new Response(JSON.stringify({ external: { email: true }, disable_signup: false }), { status: 200 });
    }) as unknown as typeof fetch;
    await verifyConnection(c, fetcher);
    expect(called).toBe(`${BASE}/auth/v1/settings ${c.anonKey}`);
  });

  it('explains a rejected key, an unreachable host, a paused project and a non-Supabase site', async () => {
    await expect(verifyConnection(c, reply(401, { message: 'Invalid API key' }))).rejects.toThrow(/did not accept the key/);
    await expect(verifyConnection(c, (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).rejects.toThrow(/Could not reach/);
    await expect(verifyConnection(c, reply(540, {}))).rejects.toThrow(/not responding/);
    await expect(verifyConnection(c, reply(404, { message: 'Not found' }))).rejects.toThrow(/does not look like a Supabase project/);
  });
});
