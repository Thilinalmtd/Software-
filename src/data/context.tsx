import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Member } from '@/domain/types';
import { clearConnection, getConnection, getMode, saveConnection, setMode, type AppMode, type Connection } from './config';
import { DemoRepository, emptyStore } from './demo-repository';
import { seedDemo } from './demo-seed';
import type { Repository, Session } from './repository';
import { SupabaseRepository } from './supabase-repository';

interface AppDataValue {
  repo: Repository | null;
  mode: AppMode | null;
  session: Session | null;
  member: Member | null;
  /** True once the session and member row have been loaded. */
  ready: boolean;
  startDemo: () => Promise<void>;
  resetDemo: () => Promise<void>;
  connect: (c: Connection) => void;
  disconnect: () => void;
  refreshMember: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

async function createRepository(mode: AppMode | null): Promise<Repository | null> {
  if (mode === 'demo') {
    const repo = new DemoRepository();
    if (repo.isEmpty()) await seedDemo(repo);
    return repo;
  }
  if (mode === 'supabase') {
    const c = getConnection();
    return c ? new SupabaseRepository(c.url, c.anonKey) : null;
  }
  return null;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [mode, setModeState] = useState<AppMode | null>(() => getMode());
  const [repo, setRepo] = useState<Repository | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [ready, setReady] = useState(false);
  const repoRef = useRef<Repository | null>(null);

  const loadMember = useCallback(async (r: Repository) => {
    const s = await r.getSession();
    setSession(s);
    setMember(s ? await r.currentMember().catch(() => null) : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      const r = await createRepository(mode);
      if (cancelled) return;
      repoRef.current = r;
      setRepo(r);
      queryClient.clear();
      if (r) await loadMember(r);
      else {
        setSession(null);
        setMember(null);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, loadMember, queryClient]);

  useEffect(() => {
    if (!repo) return;
    return repo.onAuthChange(async (s) => {
      setSession(s);
      if (!s) {
        setMember(null);
        queryClient.clear();
      } else setMember(await repo.currentMember().catch(() => null));
    });
  }, [repo, queryClient]);

  // Live refresh when someone else changes data.
  useEffect(() => {
    if (!repo || !member?.role) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const unsubscribe = repo.subscribeChanges((table) => {
      pending.add(table);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const tables = [...pending];
        pending.clear();
        for (const t of tables) {
          if (t === 'entries' || t === 'statement_lines') {
            void queryClient.invalidateQueries({ queryKey: ['ledger'] });
            void queryClient.invalidateQueries({ queryKey: ['entries'] });
          }
          void queryClient.invalidateQueries({ queryKey: [t] });
        }
      }, 600);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [repo, member?.role, queryClient]);

  const value = useMemo<AppDataValue>(
    () => ({
      repo,
      mode,
      session,
      member,
      ready,
      startDemo: async () => {
        setMode('demo');
        setModeState('demo');
      },
      resetDemo: async () => {
        DemoRepository.clearSaved();
        const fresh = new DemoRepository(emptyStore());
        await seedDemo(fresh);
        repoRef.current = fresh;
        setRepo(fresh);
        queryClient.clear();
        await loadMember(fresh);
      },
      connect: (c: Connection) => {
        saveConnection(c);
        setMode('supabase');
        setModeState(null);
        setTimeout(() => setModeState('supabase'), 0);
      },
      disconnect: () => {
        void repoRef.current?.signOut();
        clearConnection();
        setMode(null);
        setModeState(null);
      },
      refreshMember: async () => {
        if (repoRef.current) await loadMember(repoRef.current);
      },
    }),
    [repo, mode, session, member, ready, queryClient, loadMember],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}

export function useRepo(): Repository {
  const { repo } = useAppData();
  if (!repo) throw new Error('No data connection');
  return repo;
}
