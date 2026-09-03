"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { btn, btnGo, field } from "@/lib/ui";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  listAccounts,
  listAllOrders,
  listVerifications,
  restorePass,
  reviewVerification,
  revokeOrder,
  revokePass,
  signedDocumentUrl,
  type AccountRow,
  type AdminOrderRow,
  type VerificationRow,
  type VerificationStatus,
} from "@/lib/admin-data";
import { useRuntimeEvents } from "@/lib/events-runtime";
import { isPastEvent, usd } from "@/lib/tickets";
import Flyer from "@/components/Flyer";

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

type Tab = "parties" | "accounts" | "review" | "door";

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
  const [tab, setTab] = useState<Tab>("parties");

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

  // Which party is open in the PARTIES tab, by slug. Null is the grid.
  const [party, setParty] = useState<string | null>(null);
  const [partyQuery, setPartyQuery] = useState("");
  // The one revoke in flight, keyed so only its own button says "working".
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ key: string; message: string } | null>(null);
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

  /**
   * Revoke, then re-read every order rather than patching one row in place.
   * The list under it is about to be rebuilt from the database either way,
   * and a local edit that disagrees with what comes back is the one thing
   * this screen must never show a door.
   */
  const act = async (key: string, work: () => Promise<{ ok: boolean; error?: string }>) => {
    setRevoking(key);
    setRevokeError(null);
    const out = await work();
    if (!alive.current) return;
    if (!out.ok) {
      setRevokeError({ key, message: out.error ?? "That did not go through." });
      setRevoking(null);
      return;
    }
    await loadOrders();
    if (!alive.current) return;
    setRevoking(null);
  };

  /** The guest list as a spreadsheet, for a door that would rather have paper. */
  const exportCsv = (slug: string, title: string, rows: AdminOrderRow[]) => {
    const esc = (v: string | number | null | undefined) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [
      ["name", "email", "phone", "tier", "pass", "status", "paid", "ordered"].join(","),
    ];
    for (const o of rows) {
      const status = o.cancelledAt ? "cancelled" : "";
      if (o.passes.length === 0) {
        lines.push(
          [o.buyerName, o.buyerEmail, o.buyerPhone, "gift", "", status || "gift", usd(o.totalCents), o.createdAt]
            .map(esc)
            .join(","),
        );
        continue;
      }
      for (const ps of o.passes) {
        const st = status || (ps.revokedAt ? "revoked" : ps.usedAt ? "checked in" : "valid");
        lines.push(
          [o.buyerName, o.buyerEmail, o.buyerPhone, ps.tierName, ps.code, st, usd(o.totalCents), o.createdAt]
            .map(esc)
            .join(","),
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-guest-list.csv`;
    a.click();
    // Released on the next tick so the click above has already started it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    void title;
  };

  const toggleExpanded = (slug: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const tabs: { id: Tab; label: string; badge: React.ReactNode }[] = [
    {
      id: "parties",
      label: "PARTIES",
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

      {tab === "parties" && (
        <section>
          {runtimeEvents.error && (
            <p className="label mt-5 text-silverfaint">
              THE EVENT LIST FELL BACK TO THE BUILT-IN DATES - {runtimeEvents.error.toUpperCase()}. ANYTHING POSTED FROM /ADMIN/EVENTS SINCE MAY NOT SHOW UP YET.
            </p>
          )}

          {orders.kind === "loading" && <Waiting what="READING EVERY ORDER…" />}
          {orders.kind === "error" && (
            <Failed message={orders.message} onRetry={retryOrders} />
          )}

          {orders.kind === "ready" && party === null && (
            <>
              {/* ------------------------------------------------ totals -- */}
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

              {/* ----------------------------------------------- upcoming -- */}
              <div className="label mt-9 flex items-center justify-between border-b border-line py-3">
                <span className="text-silverfaint">UPCOMING</span>
                <span className="text-chalk">{upcomingEvents.length}</span>
              </div>

              {upcomingEvents.length === 0 ? (
                <Empty>No upcoming dates on the list right now.</Empty>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {upcomingEvents.map((e) => {
                    const st = statsBySlug.get(e.slug) ?? emptyStats();
                    return (
                      <button
                        key={e.slug}
                        type="button"
                        onClick={() => {
                          setParty(e.slug);
                          setPartyQuery("");
                          setRevokeError(null);
                        }}
                        className="group flex flex-col border border-line bg-ink text-left transition-colors hover:border-bloodhi"
                      >
                        <span className="relative block aspect-[3/4] overflow-hidden">
                          {e.imageId ? (
                            <Flyer
                              id={e.imageId}
                              alt={e.title}
                              sizes="(max-width:639px) 46vw, (max-width:1023px) 30vw, 280px"
                              maxWidth={400}
                              className="transition-transform duration-500 group-hover:scale-[1.03]"
                            />
                          ) : (
                            <span className="hairline-x label flex h-full items-center justify-center bg-ink2 text-silverfaint">
                              NO FLYER
                            </span>
                          )}
                          <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.94)] via-[rgba(5,5,5,0.2)] to-transparent" />
                          <span className="absolute right-2 bottom-2 left-2">
                            <span className="font-display block text-[1.5rem] leading-none text-chalk">
                              {st.admitCount}
                            </span>
                            <span className="label text-silverfaint">
                              {st.admitCount === 1 ? "RSVP" : "RSVPS"} · {usd(st.ticketNetCents)}
                            </span>
                          </span>
                        </span>
                        <span className="block p-3">
                          <span className="block truncate text-[0.9375rem] text-chalk">
                            {e.title}
                          </span>
                          <span className="label mt-1 block text-silverfaint">
                            {e.dow} {e.date}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* --------------------------------------------------- past -- */}
              {pastEvents.length > 0 && (
                <>
                  <div className="label mt-10 flex items-center justify-between border-b border-line py-3">
                    <span className="text-silverfaint">PAST</span>
                    <span className="text-chalk">{pastEvents.length}</span>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {pastEvents.map((e) => {
                      const st = statsBySlug.get(e.slug) ?? emptyStats();
                      return (
                        <button
                          key={e.slug}
                          type="button"
                          onClick={() => {
                            setParty(e.slug);
                            setPartyQuery("");
                            setRevokeError(null);
                          }}
                          className="group flex flex-col border border-line bg-ink text-left opacity-70 transition-opacity hover:opacity-100"
                        >
                          <span className="relative block aspect-[3/4] overflow-hidden">
                            {e.imageId ? (
                              <Flyer
                                id={e.imageId}
                                alt={e.title}
                                sizes="(max-width:639px) 30vw, 160px"
                                maxWidth={256}
                                className="grayscale"
                              />
                            ) : (
                              <span className="hairline-x flex h-full bg-ink2" />
                            )}
                          </span>
                          <span className="block p-2">
                            <span className="label block truncate text-chalk">{e.title}</span>
                            <span className="label mt-0.5 block text-silverfaint">
                              {st.admitCount} · {usd(st.ticketNetCents)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
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
          )}

          {/* ================================================= one party == */}
          {orders.kind === "ready" && party !== null && (() => {
            const e = runtimeEvents.events.find((x) => x.slug === party);
            const st = statsBySlug.get(party) ?? emptyStats();
            const q = partyQuery.trim().toLowerCase();
            const hit = (o: AdminOrderRow) =>
              !q ||
              o.buyerName.toLowerCase().includes(q) ||
              o.buyerEmail.toLowerCase().includes(q) ||
              o.passes.some((ps) => ps.code.toLowerCase().includes(q));
            const live = st.rows.filter(hit);
            const gone = st.cancelledRows.filter(hit);
            const revokedCount = st.rows.reduce(
              (n, o) => n + o.passes.filter((ps) => ps.revokedAt).length,
              0,
            );

            return (
              <>
                <button
                  type="button"
                  onClick={() => setParty(null)}
                  className="label mt-6 text-silverfaint transition-colors hover:text-chalk"
                >
                  &larr; ALL PARTIES
                </button>

                {/* ---------------------------------------------- header -- */}
                <div className="mt-4 flex gap-4">
                  <div className="relative w-24 shrink-0 overflow-hidden border border-line sm:w-32">
                    <div className="aspect-[3/4]">
                      {e?.imageId ? (
                        <Flyer id={e.imageId} alt={e.title} sizes="128px" maxWidth={256} />
                      ) : (
                        <div className="hairline-x h-full bg-ink2" />
                      )}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-[0.9] break-words">
                      {e?.title ?? party}
                    </h2>
                    <p className="label mt-2 text-silverfaint">
                      {e ? `${e.dow} ${e.date} · ${e.time} · ${e.venue}` : "NOT ON THE CURRENT EVENT LIST"}
                    </p>
                    {e && isPastEvent(e) && (
                      <span className="label mt-2 inline-block border border-line px-2 py-1 text-silverfaint">
                        PAST
                      </span>
                    )}
                  </div>
                </div>

                {/* --------------------------------------------- numbers -- */}
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi label="RSVPS" value={String(st.admitCount)} sub={`${st.orderCount} ORDERS`} />
                  <Kpi label="TICKET REVENUE" value={usd(st.ticketNetCents)} sub="AFTER PROMOS, BEFORE FEES" />
                  <Kpi label="COLLECTED" value={usd(st.grossCents)} sub="FEES INCLUDED" />
                  <Kpi
                    label="CHECKED IN"
                    value={`${st.checkedIn} / ${st.passCount}`}
                    sub={revokedCount > 0 ? `${revokedCount} REVOKED` : "AT THE DOOR"}
                  />
                </div>
                {st.donationCents > 0 && (
                  <p className="label mt-3 text-silverfaint">
                    PLUS {usd(st.donationCents)} IN GIFTS
                  </p>
                )}

                {/* ----------------------------------------------- tiers -- */}
                {st.tiers.size > 0 && (
                  <div className="mt-6 overflow-x-auto">
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
                        {[...st.tiers.entries()].map(([tierId, t]) => (
                          <tr key={tierId} className="border-b border-line">
                            <td className="py-2 pr-4 text-[0.9375rem] text-chalk">{t.tierName}</td>
                            <td className="label py-2 pr-4 text-silverdim">{t.qty}</td>
                            <td className="label py-2 pr-4 text-silverdim">{t.admits}</td>
                            <td className="label py-2 text-silverdim">{usd(t.revenueCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ------------------------------------------ guest list -- */}
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
                  <span className="label text-silverfaint">
                    WHO&rsquo;S COMING <span className="text-chalk">{st.rows.length}</span>
                  </span>
                  {st.rows.length + st.cancelledRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => exportCsv(party, e?.title ?? party, [...st.rows, ...st.cancelledRows])}
                      className="label border border-line px-3 py-2 text-silverdim transition-colors hover:border-linehi hover:text-chalk"
                    >
                      DOWNLOAD CSV
                    </button>
                  )}
                </div>

                {st.rows.length + st.cancelledRows.length === 0 ? (
                  <Empty>Nobody has RSVP&rsquo;d to this one yet.</Empty>
                ) : (
                  <>
                    <input
                      value={partyQuery}
                      onChange={(ev) => setPartyQuery(ev.target.value)}
                      placeholder="Find a name, email or ticket code"
                      aria-label="Search the guest list"
                      className={`${field} mt-4 w-full`}
                    />

                    {live.length === 0 && gone.length === 0 && (
                      <Empty>Nobody on this list matches that.</Empty>
                    )}

                    <ul className="mt-4 flex flex-col gap-3">
                      {live.map((o) => {
                        const orderKey = `order:${o.id}`;
                        const orderBusy = revoking === orderKey;
                        return (
                          <li key={o.id} className="border border-line p-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-[1rem] text-chalk">{o.buyerName || "—"}</p>
                                <p className="label mt-0.5 break-all text-silverdim">{o.buyerEmail}</p>
                                {o.buyerPhone && (
                                  <p className="label text-silverfaint">{o.buyerPhone}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="label text-chalk">{usd(o.totalCents)}</p>
                                <p className="label text-silverfaint">{when(o.createdAt)}</p>
                                {o.promoCode && (
                                  <p className="label text-silverfaint">PROMO {o.promoCode}</p>
                                )}
                              </div>
                            </div>

                            {o.passes.length === 0 ? (
                              <p className="label mt-3 text-silverfaint">GIFT - NO TICKET ON THIS ORDER</p>
                            ) : (
                              <ul className="mt-3 flex flex-col gap-2">
                                {o.passes.map((ps) => {
                                  const key = `pass:${ps.code}`;
                                  const busy = revoking === key;
                                  const state = ps.revokedAt ? "REVOKED" : ps.usedAt ? "CHECKED IN" : "VALID";
                                  return (
                                    <li
                                      key={ps.code}
                                      className={`flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 ${
                                        ps.revokedAt ? "opacity-60" : ""
                                      }`}
                                    >
                                      <span className="min-w-0">
                                        <span className={`label ${ps.revokedAt ? "line-through" : ""} text-chalk`}>
                                          {ps.tierName}
                                          {ps.admits > 1 ? ` · ADMITS ${ps.admits}` : ""}
                                        </span>
                                        <span className="label ml-2 text-silverfaint">{ps.code}</span>
                                      </span>
                                      <span className="flex items-center gap-2">
                                        <span
                                          className={`label border px-2 py-1 ${
                                            ps.revokedAt
                                              ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
                                              : ps.usedAt
                                                ? "border-linehi text-chalk"
                                                : "border-line text-silverdim"
                                          }`}
                                        >
                                          {state}
                                        </span>
                                        {ps.revokedAt ? (
                                          <button
                                            type="button"
                                            disabled={revoking !== null}
                                            onClick={() => void act(key, () => restorePass(ps.code))}
                                            className="label min-h-9 border border-line px-2 text-silverdim transition-colors hover:border-linehi hover:text-chalk disabled:opacity-50"
                                          >
                                            {busy ? "…" : "RESTORE"}
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            disabled={revoking !== null}
                                            onClick={() => void act(key, () => revokePass(ps.code))}
                                            className="label min-h-9 border border-line px-2 text-silverdim transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50"
                                          >
                                            {busy ? "…" : "REVOKE"}
                                          </button>
                                        )}
                                      </span>
                                      {revokeError?.key === key && (
                                        <p className="label w-full text-bloodhi" role="alert">
                                          {revokeError.message}
                                        </p>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}

                            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                              <span className="label text-silverfaint">{o.id}</span>
                              <button
                                type="button"
                                disabled={revoking !== null}
                                onClick={() => {
                                  if (window.confirm(`Cancel the whole order for ${o.buyerName || o.buyerEmail}? Every ticket on it stops working.`)) {
                                    void act(orderKey, () => revokeOrder(o.id));
                                  }
                                }}
                                className="label min-h-9 border border-line px-3 text-silverdim transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50"
                              >
                                {orderBusy ? "CANCELLING…" : "CANCEL WHOLE ORDER"}
                              </button>
                            </div>
                            {revokeError?.key === orderKey && (
                              <p className="label mt-2 text-bloodhi" role="alert">
                                {revokeError.message}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {gone.length > 0 && (
                      <>
                        <div className="label mt-8 border-b border-line py-3 text-silverfaint">
                          CANCELLED <span className="text-chalk">{gone.length}</span>
                        </div>
                        <ul className="mt-3 flex flex-col gap-2">
                          {gone.map((o) => (
                            <li
                              key={o.id}
                              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 opacity-60"
                            >
                              <span className="min-w-0">
                                <span className="text-[0.9375rem] text-chalk line-through">
                                  {o.buyerName || "—"}
                                </span>
                                <span className="label ml-2 break-all text-silverfaint">{o.buyerEmail}</span>
                              </span>
                              <span className="label text-silverfaint">
                                {usd(o.totalCents)} · {when(o.cancelledAt ?? o.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </>
            );
          })()}
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
