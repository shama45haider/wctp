"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Client-only demo account layer.
 *
 * State lives in localStorage — there is no server, no network call and no real
 * credential anywhere. Modelled as an external store so React reads it through
 * useSyncExternalStore: no setState-in-effect, no hydration mismatch, and tabs
 * stay in sync for free.
 *
 * Swap this module for Supabase auth when the backend lands; the hook API is
 * meant to survive that change.
 */

export type Ticket = {
  eventSlug: string;
  eventTitle: string;
  code: string;
  guests: number;
  paidCents: number;
  createdAt: string;
};

export type DemoUser = {
  name: string;
  email: string;
  instagram?: string;
  verified: boolean;
  /** Year only — a full birth date is never retained. */
  birthYear?: number;
};

type Snapshot = {
  ready: boolean;
  user: DemoUser | null;
  tickets: Ticket[];
};

const USER_KEY = "wctp.demo.user";
const TICKETS_KEY = "wctp.demo.tickets";

const EMPTY: Snapshot = { ready: false, user: null, tickets: [] };

let snapshot: Snapshot = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage — state just won't persist */
  }
};

function load(): Snapshot {
  return {
    ready: true,
    user: read<DemoUser | null>(USER_KEY, null),
    tickets: read<Ticket[]>(TICKETS_KEY, []),
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  // First subscriber pulls storage in. Runs after mount, so the server and the
  // client both render the `ready: false` snapshot on first paint.
  if (!hydrated) {
    hydrated = true;
    snapshot = load();
    queueMicrotask(emit);
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === USER_KEY || e.key === TICKETS_KEY) {
      snapshot = load();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

function setUser(user: DemoUser | null) {
  snapshot = { ...snapshot, user };
  write(USER_KEY, user);
  emit();
}

function setTickets(tickets: Ticket[]) {
  snapshot = { ...snapshot, tickets };
  write(TICKETS_KEY, tickets);
  emit();
}

const makeCode = (slug: string) =>
  `WCTP-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${slug
    .slice(0, 4)
    .toUpperCase()}`;

export function useAccount() {
  const { ready, user, tickets } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const signUp = useCallback(
    (u: { name: string; email: string; instagram?: string }) =>
      setUser({ ...u, verified: false }),
    [],
  );

  const signIn = useCallback((email: string) => {
    const existing = snapshot.user;
    setUser(
      existing?.email === email
        ? existing
        : { name: email.split("@")[0], email, verified: false },
    );
  }, []);

  const signInAsDemo = useCallback(
    () =>
      setUser({
        name: "Demo Guest",
        email: "demo@wecametooparty.com",
        instagram: "@demoguest",
        verified: true,
        birthYear: 2001,
      }),
    [],
  );

  const signOut = useCallback(() => {
    setUser(null);
    setTickets([]);
  }, []);

  const markVerified = useCallback((birthYear: number) => {
    if (!snapshot.user) return;
    setUser({ ...snapshot.user, verified: true, birthYear });
  }, []);

  const addTicket = useCallback(
    (t: Omit<Ticket, "code" | "createdAt">): Ticket => {
      const ticket: Ticket = {
        ...t,
        code: makeCode(t.eventSlug),
        createdAt: new Date().toISOString(),
      };
      setTickets([
        ...snapshot.tickets.filter((p) => p.eventSlug !== t.eventSlug),
        ticket,
      ]);
      return ticket;
    },
    [],
  );

  const cancelTicket = useCallback(
    (code: string) =>
      setTickets(snapshot.tickets.filter((t) => t.code !== code)),
    [],
  );

  return {
    ready,
    user,
    tickets,
    signUp,
    signIn,
    signInAsDemo,
    signOut,
    markVerified,
    addTicket,
    cancelTicket,
  };
}

export const money = (cents: number) =>
  cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
