"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { btn, btnGo, field } from "@/lib/ui";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  listAccounts,
  listAllOrders,
  listVerifications,
  reviewVerification,
  signedDocumentUrl,
  type AccountRow,
  type AdminOrderRow,
  type VerificationRow,
  type VerificationStatus,
} from "@/lib/admin-data";
import { useRuntimeEvents } from "@/lib/events-runtime";
import { isPastEvent, usd } from "@/lib/tickets";

/**
 * The dashboard.
 *
 * There are two ways in and they are not equal. The real one is a session
 * whose user id sits in the `admins` table; everything the database holds is
 * behind that. The passphrase below it is a door-night fallback that unlocks
 * nothing but this device's own scan list, and it is only offered when the
 * account service cannot be reached at all - a gate compiled into the
 * JavaScript bundle is not access control and must never stand in front of a
 * roster of guests.
 *
 * Loading, empty and failed are drawn three different ways throughout, on
 * purpose. Left alone they collapse into the same quiet screen, and an admin
 * who reads "the database timed out" as "nobody has signed up" makes the wrong
 * call at a door with a queue behind it.
 */

const SCAN_KEY = "wctp.scanned";

type Tab = "overview" | "accounts" | "review" | "door";

type Load<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: T[] };

/** One ID photo, fetched on demand because the signed link is short-lived. */
type DocState =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error" };

// No max-width of its own: each screen sets one, and two arbitrary max-w
// utilities in the same class list do not reliably override each other.
const shell = "mx-auto w-[92vw] py-[clamp(2.5rem,8vw,5rem)]";

function when(iso: string) {
  const d = new Date(iso);
  // A malformed timestamp would otherwise render the words "Invalid Date" into
  // the middle of the roster.
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Storage, for a browser that refuses it outright.
 *
 * A locked-down phone throws on the first access rather than returning null,
 * and this page is opened on whatever handset is at the door.
 */
function quietly(work: () => void) {
  try {
    work();
  } catch {
    // The screen updates either way; the device simply does not remember.
  }
}

/** Says nothing is here yet, in words, so it cannot be read as a failure. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 text-[0.9375rem] leading-relaxed text-silverdim">
      {children}
    </p>
  );
}

function Waiting({ what }: { what: string }) {
  return (
    <p className="label mt-6 animate-pulse text-silverfaint">{what}</p>
  );
}

/** The database's own sentence, kept verbatim - it is the only clue there is. */
function Failed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="mt-6 border border-[rgba(200,16,46,0.5)] p-4"
      role="alert"
    >
      <p className="label text-bloodhi">NOTHING LOADED - THIS IS AN ERROR</p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-bloodhi">
        {message}
      </p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-silverdim">
        Do not read this as an empty list. Nothing was read at all.
      </p>
      <button onClick={onRetry} className={`${btn} mt-4`}>
        Try again
      </button>
    </div>
  );
}

function Badge<T>({ state }: { state: Load<T> }) {
  if (state.kind === "loading") return <span className="text-silverfaint">…</span>;
  if (state.kind === "error") return <span className="text-bloodhi">!</span>;
  return <span className="text-silver">{state.rows.length}</span>;
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border border-line p-4">
      <p className="label text-silverfaint">{label}</p>
      <p className="font-display mt-1 text-[1.75rem] leading-none text-chalk">
        {value}
      </p>
      {sub && <p className="label mt-1 text-silverfaint">{sub}</p>}
    </div>
  );
}

type TierStat = {
  tierName: string;
  qty: number;
  admits: number;
  revenueCents: number;
};

type EventStats = {
  admitCount: number;
  orderCount: number;
  cancelledCount: number;
  /** Ticket sales after any promo discount, before the service fee. */
  ticketNetCents: number;
  donationCents: number;
  /** What guests actually paid, service fee included. */
  grossCents: number;
  passCount: number;
  checkedIn: number;
  tiers: Map<string, TierStat>;
  rows: AdminOrderRow[];
  cancelledRows: AdminOrderRow[];
};

function emptyStats(): EventStats {
  return {
    admitCount: 0,
    orderCount: 0,
    cancelledCount: 0,
    ticketNetCents: 0,
    donationCents: 0,
    grossCents: 0,
    passCount: 0,
    checkedIn: 0,
    tiers: new Map(),
    rows: [],
    cancelledRows: [],
  };
}

function addStats(a: EventStats, b: EventStats): EventStats {
  const tiers = new Map(a.tiers);
  for (const [id, t] of b.tiers) {
    const cur = tiers.get(id);
    tiers.set(
      id,
      cur
        ? {
            tierName: cur.tierName,
            qty: cur.qty + t.qty,
            admits: cur.admits + t.admits,
            revenueCents: cur.revenueCents + t.revenueCents,
          }
        : t,
    );
  }
  return {
    admitCount: a.admitCount + b.admitCount,
    orderCount: a.orderCount + b.orderCount,
    cancelledCount: a.cancelledCount + b.cancelledCount,
    ticketNetCents: a.ticketNetCents + b.ticketNetCents,
    donationCents: a.donationCents + b.donationCents,
    grossCents: a.grossCents + b.grossCents,
    passCount: a.passCount + b.passCount,
    checkedIn: a.checkedIn + b.checkedIn,
    tiers,
    rows: [...a.rows, ...b.rows],
    cancelledRows: [...a.cancelledRows, ...b.cancelledRows],
  };
}

/**
 * One order folded into its event's running totals.
 *
 * Cancelled orders are counted and kept on hand for the guest list to show,
 * but contribute nothing to revenue or headcount - cancelling is what makes
 * that true everywhere else in the system, and a dashboard that disagreed
 * would be the one place on the site telling a promoter the wrong number.
 */
function foldOrder(s: EventStats, o: AdminOrderRow): EventStats {
  if (o.cancelledAt) {
    return { ...s, cancelledCount: s.cancelledCount + 1, cancelledRows: [...s.cancelledRows, o] };
  }

  const donationCents = o.lines
    .filter((l) => l.donation)
    .reduce((n, l) => n + l.unitCents * l.qty, 0);
  const ticketNetCents = o.subtotalCents - donationCents - o.discountCents;

  const tiers = new Map(s.tiers);
  let admitCount = s.admitCount;
  for (const l of o.lines) {
    if (l.donation) continue;
    admitCount += l.admits * l.qty;
    const cur = tiers.get(l.tierId);
    tiers.set(l.tierId, {
      tierName: l.tierName,
      qty: (cur?.qty ?? 0) + l.qty,
      admits: (cur?.admits ?? 0) + l.admits * l.qty,
      revenueCents: (cur?.revenueCents ?? 0) + l.unitCents * l.qty,
    });
  }

  return {
    admitCount,
    orderCount: s.orderCount + 1,
    cancelledCount: s.cancelledCount,
    ticketNetCents: s.ticketNetCents + ticketNetCents,
    donationCents: s.donationCents + donationCents,
    grossCents: s.grossCents + o.totalCents,
    passCount: s.passCount + o.passCount,
    checkedIn: s.checkedIn + o.checkedIn,
    tiers,
    rows: [...s.rows, o],
    cancelledRows: s.cancelledRows,
  };
}

export default function Admin() {
  const auth = useSupabaseAuth();

  // Nothing that reads storage may run during the export's prerender, so the
  // whole page waits one tick rather than rendering a locked state it would
  // immediately have to correct.
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const [accounts, setAccounts] = useState<Load<AccountRow>>({
    kind: "loading",
  });
  const [queue, setQueue] = useState<Load<VerificationRow>>({
    kind: "loading",
  });
  const [orders, setOrders] = useState<Load<AdminOrderRow>>({
    kind: "loading",
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const runtimeEvents = useRuntimeEvents();
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Carries the decision as well as the row, so the button that was pressed is
  // the one that says it is working.
  const [busy, setBusy] = useState<{
    id: string;
    status: VerificationStatus;
  } | null>(null);
  const [decisionError, setDecisionError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  const [scans, setScans] = useState<[string, string][]>([]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadScans = useCallback(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SCAN_KEY) ?? "{}");
      const rows = Object.entries(raw) as [string, string][];
      rows.sort((a, b) => b[1].localeCompare(a[1]));
      setScans(rows);
    } catch {
      setScans([]);
    }
  }, []);

  useEffect(() => {
    loadScans();
    setMounted(true);
  }, [loadScans]);

  // Neither loader drops back to the loading state on its own. A refresh after
  // a decision would otherwise blank the queue for as long as the round trip
  // takes, and a list that vanishes and comes back is the one thing this screen
  // is trying not to do. The retry buttons below set it deliberately.
  const loadAccounts = useCallback(async () => {
    const { rows, error } = await listAccounts();
    if (!alive.current) return;
    setAccounts(error ? { kind: "error", message: error } : { kind: "ready", rows });
  }, []);

  const loadQueue = useCallback(async () => {
    const { rows, error } = await listVerifications("pending");
    if (!alive.current) return;
    setQueue(error ? { kind: "error", message: error } : { kind: "ready", rows });
    // Signed links live a minute, so the ones fetched for the previous list are
    // dead weight by the time a new one lands.
    setDocs({});
  }, []);

  const loadOrders = useCallback(async () => {
    const { rows, error } = await listAllOrders();
    if (!alive.current) return;
    setOrders(error ? { kind: "error", message: error } : { kind: "ready", rows });
  }, []);

  const retryAccounts = () => {
    setAccounts({ kind: "loading" });
    void loadAccounts();
  };

  const retryQueue = () => {
    setQueue({ kind: "loading" });
    void loadQueue();
  };

  const retryOrders = () => {
    setOrders({ kind: "loading" });
    void loadOrders();
  };

  // One pass over every order, grouped by the event it belongs to. Cheap
  // enough not to worry about at this scale, and simpler to trust than a
  // second, incremental version that has to agree with this one forever.
  const statsBySlug = useMemo(() => {
    const map = new Map<string, EventStats>();
    if (orders.kind !== "ready") return map;
    for (const o of orders.rows) {
      map.set(o.eventSlug, foldOrder(map.get(o.eventSlug) ?? emptyStats(), o));
    }
    return map;
  }, [orders]);

  const knownSlugs = new Set(runtimeEvents.events.map((e) => e.slug));
  const upcomingEvents = runtimeEvents.events
    .filter((e) => !isPastEvent(e))
    .sort((a, b) => a.date.localeCompare(b.date));
  const pastEvents = runtimeEvents.events
    .filter((e) => isPastEvent(e))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Orders for a slug the current event list does not recognise - a deleted
  // or renamed event, most likely. Folded out separately so the total below
  // never silently drops money nobody can otherwise see accounted for.
  const orphanStats = [...statsBySlug.entries()]
    .filter(([slug]) => !knownSlugs.has(slug))
    .reduce((acc, [, s]) => addStats(acc, s), emptyStats());
  const orphanSlugs = [...statsBySlug.keys()].filter((s) => !knownSlugs.has(s));

  const upcomingTotal = upcomingEvents.reduce(
    (acc, e) => addStats(acc, statsBySlug.get(e.slug) ?? emptyStats()),
    emptyStats(),
  );

  const isAdmin = auth.isAdmin;
  useEffect(() => {
    if (!isAdmin) return;
    void loadAccounts();
    void loadQueue();
    void loadOrders();
  }, [isAdmin, loadAccounts, loadQueue, loadOrders]);

  const showDocument = async (id: string, path: string) => {
    setDocs((d) => ({ ...d, [id]: { kind: "loading" } }));
    const url = await signedDocumentUrl(path);
    if (!alive.current) return;
    setDocs((d) => ({
      ...d,
      [id]: url ? { kind: "ready", url } : { kind: "error" },
    }));
  };

  const decide = async (id: string, status: "approved" | "rejected") => {
    setBusy({ id, status });
    setDecisionError(null);

    const out = await reviewVerification(id, status, notes[id]);
    if (!alive.current) return;
    if (!out.ok) {
      setDecisionError({
        id,
        message: out.error ?? "The decision did not go through.",
      });
      setBusy(null);
      return;
    }

    // Approving trips the trigger in 0002 that flips profiles.verified, so the
    // roster on the other tab is stale the moment a decision lands.
    await Promise.all([loadQueue(), loadAccounts()]);
    if (!alive.current) return;
    setNotes((n) => {
      const next = { ...n };
      delete next[id];
      return next;
    });
    setBusy(null);
  };

  const clearScans = () => {
    quietly(() => localStorage.removeItem(SCAN_KEY));
    setScans([]);
  };

  if (!mounted || !auth.ready) {
    return (
      <main className={`${shell} max-w-[880px]`}>
        <p className="label text-silverfaint">CHECKING ACCESS…</p>
      </main>
    );
  }

  // ------------------------------------------------------------------ door --

  const door = (
    <>
      <div className="label mt-7 flex items-center justify-between border-y border-line py-3">
        <span className="text-silverfaint">SCANNED ON THIS DEVICE</span>
        <span className="text-chalk">{scans.length}</span>
      </div>

      {scans.length === 0 ? (
        <Empty>
          Nothing scanned on this device yet. Point any phone camera at a ticket
          QR - it opens the ticket, shows whose name is on it, and offers to
          mark it used.
        </Empty>
      ) : (
        <ul className="mt-5">
          {scans.map(([code, at]) => (
            <li
              key={code}
              className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
            >
              <span className="break-all text-chalk">{code}</span>
              <span className="whitespace-nowrap text-silverfaint">
                {new Date(at).toLocaleString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {scans.length > 0 && (
        <button
          onClick={clearScans}
          className="font-display mt-7 min-h-11 w-full border border-line py-3 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi"
        >
          Clear scan list
        </button>
      )}
    </>
  );

  // ---------------------------------------------------------- signed out ----

  if (!auth.user) {
    // An error with no session means the account service never answered, which
    // is the only situation the passphrase is offered in. A healthy project
    // with nobody signed in reports no error, and gets sent to /login instead.
    const offline = auth.error !== null;

    if (!offline) {
      return (
        <main className={`${shell} max-w-[520px]`}>
          <span className="label border border-line px-3 py-2 text-silverfaint">
            STAFF ONLY
          </span>
          <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
            Admin
          </h1>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
            Sign in with the email on the admin list. Everything here - the
            roster, the ID queue - is decided by the database, not by this page.
          </p>
          <Link href="/login" className={`${btnGo} mt-7 w-full`}>
            Go to sign in
          </Link>
          <Link
            href="/"
            className="label mt-7 block text-center text-silverfaint transition-colors hover:text-chalk"
          >
            &larr; BACK HOME
          </Link>
        </main>
      );
    }

    // No session and an error means the account service never answered. There
    // is nothing to offer here: the roster and the queue live in the database,
    // and the passphrase that used to open the scan list on this device was a
    // secret compiled into the bundle, which protected nothing and blurred what
    // being signed in meant. If the door needs the scan list without a network,
    // that belongs on its own route rather than behind a shared word.
    return (
      <main className={`${shell} max-w-[520px]`}>
        <span className="label border border-[rgba(200,16,46,0.5)] px-3 py-2 text-bloodhi">
          OFFLINE
        </span>
        <h1 className="font-display chrome mt-6 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Admin
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-bloodhi">
          {auth.error}
        </p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-silverdim">
          Signing in is not possible until the account service answers. Nothing
          here is available without it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className={`${btn} mt-7 w-full`}
        >
          Try the connection again
        </button>
        <Link
          href="/"
          className="label mt-7 block text-center text-silverfaint transition-colors hover:text-chalk"
        >
          &larr; BACK HOME
        </Link>
      </main>
    );
  }

  // ------------------------------------------------------- signed in, not ---

  if (!auth.isAdmin) {
    return (
      <main className={`${shell} max-w-[520px]`}>
        <span className="label border border-line px-3 py-2 text-silverfaint">
          NO ACCESS
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Not an admin
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          You are signed in as{" "}
          <span className="break-all text-chalk">{auth.user.email}</span>, and
          that account is not on the admin list. Door staff are added from the
          Supabase dashboard.
        </p>
        <div className="mt-7 flex flex-col gap-3">
          <button onClick={() => void auth.signOut()} className={btn}>
            Sign out
          </button>
          <Link
            href="/"
            className="label mt-2 text-center text-silverfaint transition-colors hover:text-chalk"
          >
            &larr; BACK HOME
          </Link>
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------- dashboard --

  const pending = queue.kind === "ready" ? queue.rows.length : null;

  const toggleExpanded = (slug: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const tabs: { id: Tab; label: string; badge: React.ReactNode }[] = [
    {
      id: "overview",
      label: "OVERVIEW",
      badge: <Badge state={orders} />,
    },
    { id: "accounts", label: "ACCOUNTS", badge: <Badge state={accounts} /> },
    { id: "review", label: "ID REVIEW", badge: <Badge state={queue} /> },
    {
      id: "door",
      label: "DOOR",
      badge: <span className="text-silver">{scans.length}</span>,
    },
  ];

  return (
    <main className={`${shell} max-w-[1180px]`}>
      <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
        Admin
      </h1>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="label text-silverfaint">
          SIGNED IN AS <span className="break-all text-silver">{auth.user.email}</span>
        </p>
        <div className="flex gap-3">
          <Link
            href="/admin/events"
            className="label flex min-h-11 items-center border border-line px-4 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
          >
            Events
          </Link>
          <button
            onClick={() => void auth.signOut()}
            className="label min-h-11 border border-line px-4 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
          >
            Sign out
          </button>
        </div>
      </div>

      {auth.error && (
        <p className="label mt-4 border border-[rgba(200,16,46,0.5)] p-3 leading-loose text-bloodhi" role="alert">
          {auth.error}
        </p>
      )}

      <div className="mt-7 flex border-y border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`label flex min-h-11 flex-1 items-center justify-center gap-2 border-r border-line px-2 uppercase transition-colors last:border-r-0 ${
              tab === t.id
                ? "bg-ink2 text-chalk"
                : "text-silverfaint hover:text-silverdim"
            }`}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section>
          <div className="label mt-7 flex items-center justify-between border-b border-line py-3">
            <span className="text-silverfaint">MONEY AND RSVPS</span>
            <span className="text-chalk">
              {orders.kind === "ready" ? `${orders.rows.length} ORDERS TOTAL` : "—"}
            </span>
          </div>

          {runtimeEvents.error && (
            <p className="label mt-3 text-silverfaint">
              THE EVENT LIST FELL BACK TO THE BUILT-IN DATES - {runtimeEvents.error.toUpperCase()}. ANYTHING POSTED FROM /ADMIN/EVENTS SINCE MAY NOT SHOW UP YET.
            </p>
          )}

          {orders.kind === "loading" && <Waiting what="READING EVERY ORDER…" />}
          {orders.kind === "error" && (
            <Failed message={orders.message} onRetry={retryOrders} />
          )}

          {orders.kind === "ready" &&
            (orders.rows.length === 0 ? (
              <Empty>
                Every order loaded and there are none yet. Numbers show up
                here the moment the first ticket sells.
              </Empty>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi label="UPCOMING RSVPS" value={String(upcomingTotal.admitCount)} />
                  <Kpi
                    label="TICKET REVENUE"
                    value={usd(upcomingTotal.ticketNetCents)}
                    sub="AFTER PROMOS, BEFORE FEES"
                  />
                  <Kpi
                    label="COLLECTED"
                    value={usd(upcomingTotal.grossCents)}
                    sub="WHAT GUESTS PAID, FEES INCLUDED"
                  />
                  <Kpi
                    label="CHECKED IN"
                    value={`${upcomingTotal.checkedIn} / ${upcomingTotal.passCount}`}
                    sub="ACROSS ALL DOORS"
                  />
                </div>
                {upcomingTotal.donationCents > 0 && (
                  <p className="label mt-3 text-silverfaint">
                    PLUS {usd(upcomingTotal.donationCents)} IN GIFTS ACROSS UPCOMING DATES
                  </p>
                )}

                <h2 className="font-display mt-9 text-[1.5rem]">Upcoming</h2>
                {upcomingEvents.length === 0 ? (
                  <Empty>No upcoming dates on the list right now.</Empty>
                ) : (
                  <div className="mt-4 flex flex-col gap-6">
                    {upcomingEvents.map((e) => {
                      const s = statsBySlug.get(e.slug) ?? emptyStats();
                      const open = expanded.has(e.slug);
                      return (
                        <div key={e.slug} className="border border-line p-4 sm:p-5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div>
                              <p className="text-[1.125rem] text-chalk">{e.title}</p>
                              <p className="label mt-1 text-silverfaint">
                                {e.dow} {e.date} · {e.time} · {e.venue}
                              </p>
                            </div>
                            {s.cancelledCount > 0 && (
                              <span className="label border border-line px-2 py-1 text-silverfaint">
                                {s.cancelledCount} CANCELLED
                              </span>
                            )}
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Kpi label="RSVPS" value={String(s.admitCount)} />
                            <Kpi label="TICKET REVENUE" value={usd(s.ticketNetCents)} />
                            <Kpi label="COLLECTED" value={usd(s.grossCents)} />
                            <Kpi label="CHECKED IN" value={`${s.checkedIn} / ${s.passCount}`} />
                          </div>
                          {s.donationCents > 0 && (
                            <p className="label mt-3 text-silverfaint">
                              PLUS {usd(s.donationCents)} IN GIFTS
                            </p>
                          )}

                          {s.tiers.size > 0 && (
                            <div className="mt-5 overflow-x-auto">
                              <table className="w-full min-w-[420px] border-collapse text-left">
                                <thead>
                                  <tr className="label border-b border-line text-silverfaint">
                                    <th className="py-2 pr-4 font-normal">TIER</th>
                                    <th className="py-2 pr-4 font-normal">SOLD</th>
                                    <th className="py-2 pr-4 font-normal">ADMITS</th>
                                    <th className="py-2 font-normal">REVENUE</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...s.tiers.entries()].map(([tierId, t]) => (
                                    <tr key={tierId} className="border-b border-line">
                                      <td className="py-2 pr-4 text-[0.9375rem] text-chalk">
                                        {t.tierName}
                                      </td>
                                      <td className="label py-2 pr-4 text-silverdim">{t.qty}</td>
                                      <td className="label py-2 pr-4 text-silverdim">{t.admits}</td>
                                      <td className="label py-2 text-silverdim">
                                        {usd(t.revenueCents)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {s.rows.length === 0 && s.cancelledRows.length === 0 ? (
                            <p className="mt-4 text-[0.9375rem] text-silverdim">
                              Nobody has RSVP&apos;d yet.
                            </p>
                          ) : (
                            <>
                              <button
                                onClick={() => toggleExpanded(e.slug)}
                                className="label mt-5 text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk hover:decoration-silverdim"
                              >
                                {open
                                  ? "HIDE GUEST LIST"
                                  : `SHOW GUEST LIST (${s.rows.length})`}
                              </button>

                              {open && (
                                <div className="mt-4 overflow-x-auto">
                                  <table className="w-full min-w-[560px] border-collapse text-left">
                                    <thead>
                                      <tr className="label border-b border-line text-silverfaint">
                                        <th className="py-2 pr-4 font-normal">GUEST</th>
                                        <th className="py-2 pr-4 font-normal">TIER</th>
                                        <th className="py-2 pr-4 font-normal">PAID</th>
                                        <th className="py-2 font-normal">WHEN</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {s.rows.map((o) => (
                                        <tr
                                          key={o.id}
                                          className="border-b border-line align-baseline"
                                        >
                                          <td className="py-2 pr-4 text-[0.9375rem] text-chalk">
                                            {o.buyerName || "—"}
                                            <span className="label block text-silverfaint">
                                              {o.buyerEmail}
                                            </span>
                                          </td>
                                          <td className="label py-2 pr-4 text-silverdim">
                                            {o.lines
                                              .map((l) => `${l.qty}× ${l.tierName}`)
                                              .join(", ") || "—"}
                                          </td>
                                          <td className="label py-2 pr-4 text-silverdim">
                                            {usd(o.totalCents)}
                                          </td>
                                          <td className="label py-2 whitespace-nowrap text-silverfaint">
                                            {when(o.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                      {s.cancelledRows.map((o) => (
                                        <tr
                                          key={o.id}
                                          className="border-b border-line align-baseline opacity-50"
                                        >
                                          <td className="py-2 pr-4 text-[0.9375rem] text-chalk line-through">
                                            {o.buyerName || "—"}
                                            <span className="label block text-silverfaint no-underline">
                                              {o.buyerEmail}
                                            </span>
                                          </td>
                                          <td className="label py-2 pr-4 text-silverdim">
                                            CANCELLED
                                          </td>
                                          <td className="label py-2 pr-4 text-silverdim">
                                            {usd(o.totalCents)}
                                          </td>
                                          <td className="label py-2 whitespace-nowrap text-silverfaint">
                                            {when(o.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {pastEvents.length > 0 && (
                  <>
                    <h2 className="font-display mt-10 text-[1.5rem]">Past</h2>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left">
                        <thead>
                          <tr className="label border-b border-line text-silverfaint">
                            <th className="py-2 pr-4 font-normal">EVENT</th>
                            <th className="py-2 pr-4 font-normal">DATE</th>
                            <th className="py-2 pr-4 font-normal">RSVPS</th>
                            <th className="py-2 font-normal">TICKET REVENUE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pastEvents.map((e) => {
                            const s = statsBySlug.get(e.slug) ?? emptyStats();
                            return (
                              <tr key={e.slug} className="border-b border-line">
                                <td className="py-2 pr-4 text-[0.9375rem] text-chalk">
                                  {e.title}
                                </td>
                                <td className="label py-2 pr-4 whitespace-nowrap text-silverfaint">
                                  {e.date}
                                </td>
                                <td className="label py-2 pr-4 text-silverdim">
                                  {s.admitCount}
                                </td>
                                <td className="label py-2 text-silverdim">
                                  {usd(s.ticketNetCents)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {orphanSlugs.length > 0 && (
                  <p className="label mt-8 border border-line p-3 leading-loose text-silverfaint">
                    {orphanStats.orderCount} ORDER{orphanStats.orderCount === 1 ? "" : "S"} (
                    {usd(orphanStats.ticketNetCents)}) AGAINST {orphanSlugs.length} EVENT SLUG
                    {orphanSlugs.length === 1 ? "" : "S"} NOT ON THE CURRENT LIST -{" "}
                    {orphanSlugs.join(", ")}. INCLUDED IN NOTHING ABOVE.
                  </p>
                )}
              </>
            ))}
        </section>
      )}

      {tab === "accounts" && (
        <section>
          <div className="label mt-7 flex items-center justify-between border-b border-line py-3">
            <span className="text-silverfaint">ACCOUNTS</span>
            <span className="text-chalk">
              {accounts.kind === "ready" ? accounts.rows.length : "—"}
            </span>
          </div>

          {accounts.kind === "loading" && <Waiting what="READING THE ROSTER…" />}
          {accounts.kind === "error" && (
            <Failed message={accounts.message} onRetry={retryAccounts} />
          )}
          {accounts.kind === "ready" &&
            (accounts.rows.length === 0 ? (
              <Empty>
                The roster loaded and it is empty. Nobody has made an account
                yet.
              </Empty>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left">
                  <thead>
                    <tr className="label border-b border-line text-silverfaint">
                      <th className="py-3 pr-4 font-normal">NAME</th>
                      <th className="py-3 pr-4 font-normal">EMAIL</th>
                      <th className="py-3 pr-4 font-normal">INSTAGRAM</th>
                      <th className="py-3 pr-4 font-normal">JOINED</th>
                      <th className="py-3 font-normal">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.rows.map((a) => (
                      <tr key={a.id} className="border-b border-line align-baseline">
                        <td className="py-3 pr-4 text-[0.9375rem] text-chalk">
                          {a.name.trim() || "—"}
                        </td>
                        <td className="label py-3 pr-4 break-all text-silverdim">
                          {a.email}
                        </td>
                        <td className="label py-3 pr-4 break-all text-silverdim">
                          {a.instagram ? `@${a.instagram.replace(/^@/, "")}` : "—"}
                        </td>
                        <td className="label py-3 pr-4 whitespace-nowrap text-silverfaint">
                          {when(a.createdAt)}
                        </td>
                        <td className="py-3">
                          <span
                            className={`label inline-flex whitespace-nowrap border px-2 py-1 ${
                              a.verified
                                ? "border-linehi text-chalk"
                                : "border-[rgba(200,16,46,0.5)] text-bloodhi"
                            }`}
                          >
                            {a.verified ? "VERIFIED" : "AWAITING"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      )}

      {tab === "review" && (
        <section>
          <div className="mt-7 flex items-baseline justify-between border-b border-line py-3">
            <span className="label text-silverfaint">WAITING ON YOU</span>
            <span
              className={`font-display text-[2.5rem] leading-none ${
                queue.kind === "error" ? "text-bloodhi" : "text-chalk"
              }`}
            >
              {queue.kind === "ready" ? pending : queue.kind === "error" ? "?" : "…"}
            </span>
          </div>

          {queue.kind === "loading" && <Waiting what="READING THE QUEUE…" />}
          {queue.kind === "error" && (
            <Failed message={queue.message} onRetry={retryQueue} />
          )}
          {queue.kind === "ready" &&
            (queue.rows.length === 0 ? (
              <Empty>
                The queue loaded and it is empty. Nobody is waiting on an ID
                check.
              </Empty>
            ) : (
              <ul className="mt-5 flex flex-col gap-4">
                {queue.rows.map((v) => {
                  const doc = docs[v.id];
                  const working = busy?.id === v.id ? busy.status : null;
                  // Bound to a const so the handler below closes over a path
                  // that is known to exist rather than a nullable field.
                  const documentPath = v.documentPath;
                  return (
                    <li key={v.id} className="border border-line p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[1.0625rem] text-chalk">
                          {v.profile
                            ? v.profile.name.trim() || "No name on file"
                            : "Name did not load"}
                        </span>
                        <span className="label border border-line px-2 py-1 text-silverfaint">
                          {v.method.toUpperCase()}
                        </span>
                      </div>

                      <p className="label mt-2 break-all text-silverdim">
                        {v.profile?.email ?? v.userId}
                      </p>
                      {!v.profile && (
                        // The roster lookup is separate from the queue and can
                        // fail on its own; say so rather than let a user id
                        // look like somebody's name.
                        <p className="label mt-1 text-bloodhi">
                          NAME AND EMAIL DID NOT LOAD - THIS IS THE USER ID
                        </p>
                      )}

                      <p className="label mt-2 text-silverfaint">
                        SUBMITTED {when(v.createdAt)}
                        {v.birthYear ? ` · BORN ${v.birthYear}` : ""}
                      </p>

                      {v.method === "document" && documentPath && (
                        <div className="mt-3">
                          <button
                            onClick={() => void showDocument(v.id, documentPath)}
                            className="label inline-flex min-h-11 items-center text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk hover:decoration-silverdim"
                          >
                            {doc?.kind === "ready" ? "RELOAD ID PHOTO" : "SHOW ID PHOTO"}
                          </button>

                          {doc?.kind === "loading" && (
                            <p className="label animate-pulse text-silverfaint">
                              FETCHING A SIGNED LINK…
                            </p>
                          )}
                          {doc?.kind === "error" && (
                            <p className="label text-bloodhi" role="alert">
                              COULD NOT OPEN IT. THE FILE IS MISSING, OR STORAGE
                              REFUSED THE READ.
                            </p>
                          )}
                          {doc?.kind === "ready" && (
                            <div className="mt-2">
                              {/* Plain <img>: the signed URL's host is not in
                                  next.config's remotePatterns, and it should
                                  not be - the link changes every time. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={doc.url}
                                alt={`ID submitted by ${v.profile?.email ?? v.userId}`}
                                className="max-h-[60vh] w-full border border-line object-contain"
                              />
                              <p className="label mt-2 text-silverfaint">
                                THIS LINK DIES AFTER A MINUTE. RELOAD IT IF THE
                                IMAGE GOES BLANK.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      <input
                        value={notes[v.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [v.id]: e.target.value }))
                        }
                        placeholder="Note (optional) - why this was rejected"
                        aria-label="Review note"
                        className={`${field} mt-4 w-full`}
                      />

                      {/* Every row goes dead while one decision is in flight.
                          The list is about to be refetched underneath them,
                          and a second decision racing that refetch would be
                          aimed at a row that has already moved. */}
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          onClick={() => void decide(v.id, "approved")}
                          disabled={busy !== null}
                          className={btnGo}
                        >
                          {working === "approved" ? "Saving…" : "Approve"}
                        </button>
                        <button
                          onClick={() => void decide(v.id, "rejected")}
                          disabled={busy !== null}
                          className={btn}
                        >
                          {working === "rejected" ? "Saving…" : "Reject"}
                        </button>
                      </div>

                      {decisionError?.id === v.id && (
                        <p
                          className="label mt-3 leading-loose text-bloodhi"
                          role="alert"
                        >
                          {decisionError.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
        </section>
      )}

      {tab === "door" && (
        <section>
          <p className="mt-7 text-[0.9375rem] leading-relaxed text-silverdim">
            Point any phone camera at a ticket QR. It opens the ticket, shows
            whose name is on it, and offers to mark it used.
          </p>
          {door}
        </section>
      )}

      <Link
        href="/"
        className="label mt-10 block text-center text-silverfaint transition-colors hover:text-chalk"
      >
        &larr; BACK HOME
      </Link>
    </main>
  );
}
