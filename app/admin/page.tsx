"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { btn, btnGo, field, num, tableEl, tableWrap, td, th } from "@/lib/ui";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  listAccounts,
  listAllOrders,
  listVerifications,
  listVerificationsForUser,
  resetVerification,
  restorePass,
  reviewVerification,
  revokePass,
  signedDocumentUrl,
  type AccountRow,
  type AdminOrderRow,
  type VerificationRow,
  type VerificationStatus,
} from "@/lib/admin-data";
import { useRuntimeEvents } from "@/lib/events-runtime";
import { isPastEvent, usd } from "@/lib/tickets";
import { atHandle } from "@/lib/handle";
import Flyer from "@/components/Flyer";
import { avatarUrl } from "@/lib/profile-data";
import RaffleAdmin from "@/components/RaffleAdmin";

/**
 * The dashboard.
 *
 * There is one way in, and it is a session whose user id sits in the `admins`
 * table. Everything the database holds sits behind that, and this file decides
 * none of it - row-level security refuses the read regardless of what gets
 * drawn here. The passphrase that used to sit under the sign-in is gone: a
 * secret compiled into the JavaScript bundle is not access control and must
 * never stand in front of a roster of guests.
 *
 * The frame is a control panel rather than a page. A header band says what
 * this is and who is holding it, a section list runs down the left on a desk
 * and folds into a grid of four buttons on a phone, and everything inside is
 * a panel with a head and a body so the eye lands in the same place on every
 * tab. The phone is the device that matters, because this is opened at a door
 * with a queue behind it: nothing tappable is smaller than a thumb, and the
 * only things allowed to hide behind a sideways scroll are the wide tables.
 *
 * Loading, empty and failed are drawn three different ways throughout, on
 * purpose - a pulse, a dashed frame around a plain sentence, and a red-bordered
 * alert that keeps the database's own words. Left alone they collapse into the
 * same quiet screen, and an admin who reads "the database timed out" as
 * "nobody has signed up" makes the wrong call at that door.
 */

const SCAN_KEY = "wctp.scanned";

type Tab = "parties" | "accounts" | "review" | "door" | "raffle";

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
// utilities in the same class list do not reliably override each other. The
// gate screens use this; the dashboard runs wider and tighter than a page of
// prose wants to, and sets its own.
const shell = "mx-auto w-[92vw] py-[clamp(2.5rem,8vw,5rem)]";

/** The quiet controls in the app bar, which are chrome rather than actions. */
const headBtn =
  "label flex min-h-9 items-center border border-line px-3 tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-linehi hover:bg-ink2 hover:text-chalk";

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
 * How an account is named on every screen here: its Instagram handle with the
 * @ put back. An account that predates handles has no handle to show, so it
 * keeps whatever it signed up with rather than gaining an @ it never had.
 */
function displayName(name: string, instagram: string | null) {
  return instagram ? atHandle(name) : name.trim();
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

/**
 * The panel system.
 *
 * Everything on every tab is a Panel. The problem this rewrite fixes is that
 * the panel edge, the dividers between its rows and the outline of every tag
 * inside it were all the same --line, so a screen of six panels read as forty
 * equally-loud boxes and the eye had nowhere to land. Three weights now:
 * --line for the edge of a panel, --line-soft for dividers between rows inside
 * one, and --line-hi reserved for something deliberately raised.
 *
 * Padding is on a two-step scale - 0.875rem across a head, 1.25rem through a
 * body - rather than a uniform p-4, so a head reads as trim and a body as room.
 */
function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-line bg-ink ${className}`}>
      {children}
    </section>
  );
}

/**
 * The bar across the top of a panel.
 *
 * `right` takes a control - a search box, an export button - so a filter no
 * longer needs a whole bordered panel of its own just to hold one input, which
 * is what made the parties tab read as a stack of empty frames.
 */
function PanelHead({
  title,
  sub,
  count,
  right,
}: {
  title: string;
  sub?: string;
  count?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <p className="label flex items-center gap-2 tracking-[0.11em] text-silverdim uppercase">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-ink2 px-2 py-0.5 text-silver tabular-nums">
              {count}
            </span>
          )}
        </p>
        {sub && (
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-silverfaint">
            {sub}
          </p>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

function PanelBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-5 py-5 ${className}`}>{children}</div>;
}

/**
 * Says nothing is here yet, in words, inside a dashed frame that no other
 * state uses - so it can be told apart from a failure at a glance and read as
 * one on a second look.
 */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-line px-4 py-6 text-center">
      <p className="mx-auto max-w-[46ch] text-[0.9375rem] leading-relaxed text-silverdim">
        {children}
      </p>
    </div>
  );
}

/** Still going: a pulse, which neither of the other two states has. */
function Waiting({ what }: { what: string }) {
  return (
    <p className="label flex animate-pulse items-center gap-2 tracking-[0.11em] text-silverfaint uppercase">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-silverfaint" />
      {what}
    </p>
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
      className="border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] p-4"
      role="alert"
    >
      <p className="label tracking-[0.11em] text-bloodhi uppercase">
        Nothing loaded - this is an error
      </p>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-bloodhi">
        {message}
      </p>
      <p className="mt-2 text-[0.875rem] leading-relaxed text-silverdim">
        Not an empty list — nothing was read at all.
      </p>
      <button onClick={onRetry} className={`${btn} mt-4`}>
        Try again
      </button>
    </div>
  );
}

/**
 * The count beside a section in the nav.
 *
 * `alert` turns it red and solid rather than quiet - used for the age-review
 * queue, which is the one number on this dashboard that is a job rather than a
 * fact. A zero is drawn as a dash: "0 waiting" and "nothing waiting" are the
 * same news, and a bright 0 reads as a badge worth tapping.
 */
function Badge<T>({ state, alert = false }: { state: Load<T>; alert?: boolean }) {
  if (state.kind === "loading")
    return <span className="animate-pulse text-silverfaint">··</span>;
  if (state.kind === "error") return <span className="text-bloodhi">!</span>;

  const n = state.rows.length;
  if (n === 0) return <span className="text-silverfaint">—</span>;
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[0.6875rem] tabular-nums ${
        alert ? "bg-blood text-chalk" : "bg-ink2 text-silver"
      }`}
    >
      {n}
    </span>
  );
}

/**
 * One number, given room to be the thing that is read.
 *
 * The old version set the value at about 1.6rem, the same size as a heading
 * two lines above it, so a grid of four read as four paragraphs. The number is
 * now the largest thing in its cell by a clear margin and the label above it
 * has stepped back to let it be.
 */
function Kpi({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "plain" | "money";
}) {
  return (
    <div className="flex flex-col bg-ink px-5 py-4">
      <p className="label tracking-[0.11em] text-silverfaint uppercase">{label}</p>
      <p
        className={`font-display mt-2.5 text-[clamp(1.75rem,5.5vw,2.375rem)] leading-none tabular-nums ${
          tone === "money" ? "text-chalk" : "text-chalk"
        }`}
      >
        {value}
      </p>
      {sub && (
        <p className="label mt-auto pt-2.5 leading-relaxed text-silverfaint uppercase">
          {sub}
        </p>
      )}
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
  const runtimeEvents = useRuntimeEvents();

  // Which party is open in the PARTIES tab, by slug. Null is the grid.
  const [party, setParty] = useState<string | null>(null);
  // Which account row is open on the roster, and each one's checks, fetched
  // the first time it is opened and kept - a roster is browsed, and re-reading
  // on every tap would put a loading flash between an admin and a face.
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Load<VerificationRow>>>({});
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetError, setResetError] = useState<{ id: string; message: string } | null>(null);
  const [partyQuery, setPartyQuery] = useState("");
  // Filters the top-level event grid, and the ACCOUNTS and AGE REVIEW tabs -
  // each is its own box since they search different rows for different words.
  const [eventQuery, setEventQuery] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [reviewQuery, setReviewQuery] = useState("");
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

  const openRow = useCallback(
    async (id: string) => {
      setOpenAccount((cur) => (cur === id ? null : id));
      if (checks[id]) return;
      setChecks((c) => ({ ...c, [id]: { kind: "loading" } }));
      const { rows, error } = await listVerificationsForUser(id);
      if (!alive.current) return;
      setChecks((c) => ({
        ...c,
        [id]: error ? { kind: "error", message: error } : { kind: "ready", rows },
      }));
    },
    [checks],
  );

  /**
   * Reset, then re-read the roster and that guest's checks, so the badge and
   * the list underneath say the same thing the database now does.
   */
  const resetCheck = async (id: string) => {
    setResetting(id);
    setResetError(null);
    const out = await resetVerification(id);
    if (!alive.current) return;
    if (!out.ok) {
      setResetError({ id, message: out.error ?? "That did not go through." });
      setResetting(null);
      return;
    }
    setChecks((c) => ({ ...c, [id]: { kind: "loading" } }));
    const [, theirs] = await Promise.all([loadAccounts(), listVerificationsForUser(id)]);
    if (!alive.current) return;
    setChecks((c) => ({
      ...c,
      [id]: theirs.error
        ? { kind: "error", message: theirs.error }
        : { kind: "ready", rows: theirs.rows },
    }));
    setResetting(null);
  };

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
  // Already split and ordered against the real clock by the hook itself -
  // re-deriving it here with the frozen isPastEvent() default used to mean
  // the dashboard could disagree with the public site about which of its own
  // dates had passed.
  const upcomingEvents = runtimeEvents.upcoming;
  const pastEvents = runtimeEvents.past;

  const eq = eventQuery.trim().toLowerCase();
  const matchesEvent = (e: { title: string; dow: string; date: string }) =>
    !eq ||
    e.title.toLowerCase().includes(eq) ||
    e.dow.toLowerCase().includes(eq) ||
    e.date.toLowerCase().includes(eq);
  const shownUpcoming = upcomingEvents.filter(matchesEvent);
  const shownPast = pastEvents.filter(matchesEvent);

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

  // ---------------------------------------------------------- signed out ----

  if (!auth.user) {
    // An error with no session means the account service never answered, and
    // that is worth saying differently from a healthy project with nobody
    // signed in, which gets sent to /login instead.
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
            roster, the age review queue - is decided by the database, not by
            this page.
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

  const aq = accountQuery.trim().toLowerCase();
  const matchesAccount = (a: AccountRow) =>
    !aq ||
    a.name.toLowerCase().includes(aq) ||
    (a.firstName ?? "").toLowerCase().includes(aq) ||
    a.email.toLowerCase().includes(aq) ||
    (a.instagram ?? "").toLowerCase().includes(aq) ||
    (a.phone ?? "").toLowerCase().includes(aq);
  const shownAccounts = accounts.kind === "ready" ? accounts.rows.filter(matchesAccount) : [];

  const rq = reviewQuery.trim().toLowerCase();
  const matchesReview = (v: VerificationRow) =>
    !rq ||
    (v.profile?.name ?? "").toLowerCase().includes(rq) ||
    (v.profile?.firstName ?? "").toLowerCase().includes(rq) ||
    (v.profile?.email ?? "").toLowerCase().includes(rq) ||
    (v.profile?.instagram ?? "").toLowerCase().includes(rq) ||
    v.userId.toLowerCase().includes(rq);
  const shownQueue = queue.kind === "ready" ? queue.rows.filter(matchesReview) : [];

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

  // The four sections in one list, so the rail on a desk and the grid on a
  // phone can never drift apart or disagree about a count.
  /**
   * The five sections, once, so the rail on a desk and the strip on a phone
   * can never drift apart or disagree about a count. The hint under each label
   * is what turns a rail of five nouns into something readable cold - "DOOR"
   * alone does not say it means this handset's own scan history.
   */
  const sections: {
    id: Tab;
    label: string;
    hint: string;
    badge: React.ReactNode;
  }[] = [
    {
      id: "parties",
      label: "Parties",
      hint: "Sales and guest lists",
      badge: <Badge state={orders} />,
    },
    {
      id: "accounts",
      label: "Accounts",
      hint: "Everyone who signed up",
      badge: <Badge state={accounts} />,
    },
    {
      id: "review",
      label: "Age review",
      // The one count on this dashboard that is a job rather than a fact.
      hint: "Checks waiting on you",
      badge: <Badge state={queue} alert />,
    },
    {
      id: "door",
      label: "Door",
      hint: "Scanned on this device",
      badge:
        scans.length === 0 ? (
          <span className="text-silverfaint">—</span>
        ) : (
          <span className="rounded-full bg-ink2 px-1.5 py-0.5 text-[0.6875rem] text-silver tabular-nums">
            {scans.length}
          </span>
        ),
    },
    {
      id: "raffle",
      label: "Raffle",
      hint: "Draws and the live link",
      badge: null,
    },
  ];

  const here = sections.find((s) => s.id === tab);

  return (
    <main className="mx-auto w-[92vw] max-w-[1320px] pb-[clamp(2rem,6vw,3.5rem)]">
      {/* ----------------------------------------------------- app bar -- */}
      {/* A bar, not a banner. The old header spent about 140px of every screen
          on the word "Admin" set in display type over an eyebrow that said
          "CONTROL PANEL" - on a handset at a door that is a third of the
          viewport gone before the first real number. It sticks, so signing out
          and the jump to the event editor stay reachable from the bottom of a
          long roster. */}
      <header className="sticky top-0 z-30 -mx-[4vw] mb-4 border-b border-line bg-void/90 px-[4vw] py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-[1.0625rem] leading-none tracking-[0.06em] text-chalk uppercase">
              Admin
            </span>
            <span className="hidden h-4 w-px shrink-0 bg-line sm:block" />
            <span className="label hidden min-w-0 truncate text-silverfaint sm:block">
              {auth.user.email}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/admin/events" className={headBtn}>
              Events
            </Link>
            <button onClick={() => void auth.signOut()} className={headBtn}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {auth.error && (
        <p
          className="mb-4 border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] p-3 text-[0.9375rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {auth.error}
        </p>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-5">
        {/* A rail on a desk. It stays put while a long roster scrolls past. */}
        <nav
          aria-label="Dashboard sections"
          className="sticky top-[4.5rem] hidden border border-line bg-ink lg:block"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setTab(s.id)}
              aria-current={tab === s.id ? "page" : undefined}
              className={`flex w-full items-start gap-3 border-b border-l-2 border-b-linesoft px-4 py-3 text-left transition-colors last:border-b-0 ${
                tab === s.id
                  ? "border-l-blood bg-ink2"
                  : "border-l-transparent hover:bg-ink2/60"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[0.9375rem] leading-tight ${
                    tab === s.id ? "text-chalk" : "text-silverdim"
                  }`}
                >
                  {s.label}
                </span>
                <span className="label mt-1 block leading-snug text-silverfaint">
                  {s.hint}
                </span>
              </span>
              {s.badge && <span className="mt-0.5 shrink-0">{s.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {/* One scrolling row rather than a three-row grid. Five sections in a
              two-across grid cost three rows of vertical space on a phone and
              left the last one stretched across the full width, which read as
              more important than the four above it. */}
          <nav
            aria-label="Dashboard sections"
            className="-mx-[4vw] flex snap-x gap-2 overflow-x-auto px-[4vw] pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setTab(s.id)}
                aria-current={tab === s.id ? "page" : undefined}
                className={`flex min-h-11 shrink-0 snap-start items-center gap-2 border px-3.5 whitespace-nowrap transition-colors ${
                  tab === s.id
                    ? "border-linehi bg-ink2 text-chalk"
                    : "border-line bg-ink text-silverdim"
                }`}
              >
                <span className="text-[0.9375rem]">{s.label}</span>
                {s.badge}
              </button>
            ))}
          </nav>

          {/* Where you are and what this section is for, on every tab. The rail
              says it too, but the rail is not on screen on a phone. */}
          {here && (
            <div className="lg:hidden">
              <p className="label tracking-[0.11em] text-silverfaint uppercase">
                {here.hint}
              </p>
            </div>
          )}

          {tab === "parties" && (
            <>
              {runtimeEvents.error && (
                <Panel>
                  <PanelBody>
                    <p className="text-[0.875rem] leading-relaxed text-silverdim">
                      The event list fell back to the dates built into this
                      build - <span className="text-bloodhi">{runtimeEvents.error}</span>.
                      Anything posted from the event editor since may not show up yet.
                    </p>
                  </PanelBody>
                </Panel>
              )}

              {orders.kind === "loading" && (
                <Panel>
                  <PanelBody>
                    <Waiting what="READING EVERY ORDER…" />
                  </PanelBody>
                </Panel>
              )}
              {orders.kind === "error" && (
                <Failed message={orders.message} onRetry={retryOrders} />
              )}

              {orders.kind === "ready" && party === null && (
                <>
                  {/* -------------------------------------------- totals -- */}
                  <Panel>
                    <PanelHead
                      title="Upcoming totals"
                      sub="Every date still to come, added up. Cancelled orders count for nothing here."
                    />
                    {/* gap-px over --line-soft: the hairlines between four
                        numbers are not structure and should not weigh the same
                        as the edge of the panel holding them. */}
                    <div className="grid grid-cols-2 gap-px bg-linesoft sm:grid-cols-4">
                      <Kpi label="RSVPs" value={String(upcomingTotal.admitCount)} sub="People expected" />
                      <Kpi
                        label="Ticket revenue"
                        value={usd(upcomingTotal.ticketNetCents)}
                        sub="After promos, before fees"
                        tone="money"
                      />
                      <Kpi
                        label="Collected"
                        value={usd(upcomingTotal.grossCents)}
                        sub="What guests paid, fees in"
                        tone="money"
                      />
                      <Kpi
                        label="Checked in"
                        value={`${upcomingTotal.checkedIn} / ${upcomingTotal.passCount}`}
                        sub="Across all doors"
                      />
                    </div>
                    {upcomingTotal.donationCents > 0 && (
                      <p className="border-t border-linesoft px-5 py-3 text-[0.875rem] text-silverdim">
                        Plus{" "}
                        <span className="text-chalk tabular-nums">
                          {usd(upcomingTotal.donationCents)}
                        </span>{" "}
                        in gifts across upcoming dates.
                      </p>
                    )}
                  </Panel>

                  {/* ------------------------------------------ upcoming -- */}
                  {/* The search box used to be a panel of its own - a full
                      bordered frame wrapped around one input, sitting between
                      the numbers and the thing it filtered. It belongs in the
                      head of the list it searches. */}
                  <Panel>
                    <PanelHead
                      title="Upcoming"
                      count={shownUpcoming.length}
                      right={
                        upcomingEvents.length > 0 || pastEvents.length > 0 ? (
                          <input
                            value={eventQuery}
                            onChange={(ev) => setEventQuery(ev.target.value)}
                            placeholder="Find a party…"
                            aria-label="Search parties"
                            className={`${field} w-full min-w-0 sm:w-64`}
                          />
                        ) : undefined
                      }
                    />
                    <PanelBody>
                      {shownUpcoming.length === 0 ? (
                        <Empty>
                          {eq
                            ? "No upcoming date matches that."
                            : "No upcoming dates on the list right now."}
                        </Empty>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                          {shownUpcoming.map((e) => {
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
                                className="group flex flex-col border border-line bg-void text-left transition-colors hover:border-bloodhi"
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
                                <span className="block border-t border-line p-3">
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
                    </PanelBody>
                  </Panel>

                  {/* ---------------------------------------------- past -- */}
                  {pastEvents.length > 0 && (
                    <Panel>
                      <PanelHead
                        title="Past"
                        count={shownPast.length}
                        sub="The archive. Dimmed, and smaller on the grid, so it never competes with what is still to come."
                      />
                      <PanelBody>
                        {shownPast.length === 0 ? (
                          <Empty>No past date matches that.</Empty>
                        ) : (
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                          {shownPast.map((e) => {
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
                                className="group flex flex-col border border-line bg-void text-left opacity-70 transition-opacity hover:opacity-100"
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
                                <span className="block border-t border-line p-2">
                                  <span className="label block truncate text-chalk">{e.title}</span>
                                  <span className="label mt-0.5 block text-silverfaint">
                                    {st.admitCount} · {usd(st.ticketNetCents)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        )}
                      </PanelBody>
                    </Panel>
                  )}

                  {orphanSlugs.length > 0 && (
                    <Panel>
                      <PanelBody>
                        <p className="text-[0.875rem] leading-relaxed text-silverdim">
                          <span className="text-chalk tabular-nums">
                            {orphanStats.orderCount} order{orphanStats.orderCount === 1 ? "" : "s"}
                          </span>{" "}
                          ({usd(orphanStats.ticketNetCents)}) sit against{" "}
                          {orphanSlugs.length} event slug
                          {orphanSlugs.length === 1 ? "" : "s"} that are not on the current
                          list - <span className="text-silver">{orphanSlugs.join(", ")}</span>.
                          Deleted or renamed, most likely. Counted in nothing above.
                        </p>
                      </PanelBody>
                    </Panel>
                  )}
                </>
              )}

              {/* ============================================= one party == */}
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
                    {/* ------------------------------ header and numbers -- */}
                    {/* A breadcrumb rather than a back button boxed into the
                        card. Drilling into a party swaps the whole tab out with
                        no change of address, so this line is the only thing
                        saying where you are - it belongs above the panel, where
                        a breadcrumb goes. */}
                    <button
                      type="button"
                      onClick={() => setParty(null)}
                      className="label -my-1 flex min-h-9 items-center gap-1.5 self-start py-1 tracking-[0.11em] text-silverfaint uppercase transition-colors hover:text-chalk"
                    >
                      <span aria-hidden>&larr;</span> All parties
                    </button>

                    <Panel>
                      <PanelBody className="flex gap-4 sm:gap-5">
                        <div className="relative w-24 shrink-0 overflow-hidden border border-line sm:w-32">
                          <div className="aspect-[3/4]">
                            {e?.imageId ? (
                              <Flyer id={e.imageId} alt={e.title} sizes="128px" maxWidth={256} />
                            ) : (
                              <div className="hairline-x h-full bg-ink2" />
                            )}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-[0.9] break-words text-chalk">
                            {e?.title ?? party}
                          </h2>
                          <p className="mt-2.5 text-[0.9375rem] text-silverdim">
                            {e ? (
                              <>
                                {e.dow} {e.date}
                                <span className="text-silverfaint"> · </span>
                                {e.time}
                              </>
                            ) : (
                              "Not on the current event list"
                            )}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {e && isPastEvent(e, runtimeEvents.now) && (
                              <span className="label inline-flex items-center border border-line px-2 py-1 tracking-[0.11em] text-silverfaint uppercase">
                                Past
                              </span>
                            )}
                            {st.cancelledCount > 0 && (
                              <span className="label inline-flex items-center border border-[rgba(200,16,46,0.45)] px-2 py-1 tracking-[0.11em] text-bloodhi uppercase">
                                {st.cancelledCount} cancelled
                              </span>
                            )}
                          </div>
                        </div>
                      </PanelBody>
                      <div className="grid grid-cols-2 gap-px border-t border-line bg-linesoft sm:grid-cols-4">
                        <Kpi
                          label="RSVPs"
                          value={String(st.admitCount)}
                          sub={`${st.orderCount} order${st.orderCount === 1 ? "" : "s"}`}
                        />
                        <Kpi
                          label="Ticket revenue"
                          value={usd(st.ticketNetCents)}
                          sub="After promos, before fees"
                          tone="money"
                        />
                        <Kpi
                          label="Collected"
                          value={usd(st.grossCents)}
                          sub="Fees included"
                          tone="money"
                        />
                        <Kpi
                          label="Checked in"
                          value={`${st.checkedIn} / ${st.passCount}`}
                          sub={revokedCount > 0 ? `${revokedCount} revoked` : "At the door"}
                        />
                      </div>
                      {st.donationCents > 0 && (
                        <p className="border-t border-linesoft px-5 py-3 text-[0.875rem] text-silverdim">
                          Plus{" "}
                          <span className="text-chalk tabular-nums">
                            {usd(st.donationCents)}
                          </span>{" "}
                          in gifts.
                        </p>
                      )}
                    </Panel>

                    {/* --------------------------------------------- tiers -- */}
                    {st.tiers.size > 0 && (
                      <Panel>
                        <PanelHead title="Tiers" count={st.tiers.size} />
                        <div className={tableWrap}>
                          <table className={`${tableEl} min-w-[420px]`}>
                            <thead>
                              <tr>
                                <th className={th}>Tier</th>
                                <th className={`${th} ${num}`}>Sold</th>
                                <th className={`${th} ${num}`}>Admits</th>
                                <th className={`${th} ${num}`}>Revenue</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...st.tiers.entries()].map(([tierId, t]) => (
                                <tr key={tierId} className="transition-colors hover:bg-ink2/50">
                                  <td className={`${td} text-[0.9375rem] text-chalk`}>{t.tierName}</td>
                                  <td className={`${td} ${num} text-silverdim`}>{t.qty}</td>
                                  <td className={`${td} ${num} text-silverdim`}>{t.admits}</td>
                                  <td className={`${td} ${num} text-silver`}>{usd(t.revenueCents)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Panel>
                    )}

                    {/* ---------------------------------------- guest list -- */}
                    <Panel>
                      <PanelHead
                        title="Who’s coming"
                        count={st.rows.length}
                        right={
                          st.rows.length + st.cancelledRows.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => exportCsv(party, e?.title ?? party, [...st.rows, ...st.cancelledRows])}
                              className="label flex min-h-9 items-center border border-line px-3 tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-linehi hover:bg-ink2 hover:text-chalk"
                            >
                              Download CSV
                            </button>
                          ) : undefined
                        }
                      />

                      {st.rows.length + st.cancelledRows.length === 0 ? (
                        <PanelBody>
                          <Empty>Nobody has RSVP&rsquo;d to this one yet.</Empty>
                        </PanelBody>
                      ) : (
                        <>
                          <div className="border-b border-linesoft px-5 py-3">
                            <input
                              value={partyQuery}
                              onChange={(ev) => setPartyQuery(ev.target.value)}
                              placeholder="Find a name, email or ticket code…"
                              aria-label="Search the guest list"
                              className={`${field} w-full`}
                            />
                          </div>

                          {live.length === 0 && gone.length === 0 && (
                            <PanelBody>
                              <Empty>Nobody on this list matches that.</Empty>
                            </PanelBody>
                          )}

                          <ul>
                            {live.map((o) => (
                              <li key={o.id} className="border-b border-line px-4 py-3.5 last:border-b-0">
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
                                  <ul className="mt-3 border-t border-line">
                                    {o.passes.map((ps) => {
                                      const key = `pass:${ps.code}`;
                                      const working = revoking === key;
                                      const state = ps.revokedAt ? "CANCELLED" : ps.usedAt ? "CHECKED IN" : "VALID";
                                      return (
                                        <li
                                          key={ps.code}
                                          className={`flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-b-0 ${
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
                                                className="label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-linehi hover:text-chalk disabled:opacity-50"
                                              >
                                                {working ? "…" : "RESTORE"}
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                disabled={revoking !== null}
                                                onClick={() => void act(key, () => revokePass(ps.code))}
                                                className="label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50"
                                              >
                                                {working ? "…" : "CANCEL"}
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

                                <p className="label mt-3 text-silverfaint">{o.id}</p>
                              </li>
                            ))}
                          </ul>

                          {gone.length > 0 && (
                            <>
                              <div className="label border-y border-line bg-void px-4 py-2.5 text-silverfaint">
                                CANCELLED <span className="text-chalk">{gone.length}</span>
                              </div>
                              <ul>
                                {gone.map((o) => (
                                  <li
                                    key={o.id}
                                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5 opacity-60 last:border-b-0"
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
                    </Panel>
                  </>
                );
              })()}
            </>
          )}

          {tab === "accounts" && (
            <Panel>
              <PanelHead
                title="Accounts"
                count={accounts.kind === "ready" ? shownAccounts.length : "—"}
                sub="Everyone who has signed up. Tap a row for their age checks."
                right={
                  accounts.kind === "ready" && accounts.rows.length > 0 ? (
                    <input
                      value={accountQuery}
                      onChange={(ev) => setAccountQuery(ev.target.value)}
                      placeholder="Name, handle, email…"
                      aria-label="Search accounts"
                      className={`${field} w-full min-w-0 sm:w-72`}
                    />
                  ) : undefined
                }
              />

              {accounts.kind === "loading" && (
                <PanelBody>
                  <Waiting what="READING THE ROSTER…" />
                </PanelBody>
              )}
              {accounts.kind === "error" && (
                <PanelBody>
                  <Failed message={accounts.message} onRetry={retryAccounts} />
                </PanelBody>
              )}
              {accounts.kind === "ready" &&
                (accounts.rows.length === 0 ? (
                  <PanelBody>
                    <Empty>
                      The roster loaded and it is empty. Nobody has made an
                      account yet.
                    </Empty>
                  </PanelBody>
                ) : shownAccounts.length === 0 ? (
                  <PanelBody>
                    <Empty>Nobody on the roster matches that.</Empty>
                  </PanelBody>
                ) : (
                  <div className="overflow-x-auto">
                    <table className={`${tableEl} min-w-[680px]`}>
                      <thead>
                        <tr>
                          <th className={th}>Name</th>
                          <th className={th}>Email</th>
                          <th className={`${th} ${num}`}>Age</th>
                          <th className={th}>Joined</th>
                          <th className={th}>Age check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownAccounts.map((a) => {
                          const open = openAccount === a.id;
                          const load = checks[a.id];
                          const pic = avatarUrl(a.avatarPath);
                          const who = displayName(a.name, a.instagram);
                          return (
                            <React.Fragment key={a.id}>
                              <tr
                                onClick={() => void openRow(a.id)}
                                aria-expanded={open}
                                className={`cursor-pointer align-middle transition-colors hover:bg-ink2 ${
                                  open ? "bg-ink2" : ""
                                }`}
                              >
                                <td className={`${td} text-[0.9375rem] text-chalk`}>
                                  <span className="flex items-center gap-2.5">
                                    {pic ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={pic} alt="" className="h-8 w-8 shrink-0 rounded-full border border-line object-cover" />
                                    ) : (
                                      <span className="label flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-silverfaint">
                                        {(a.name.trim() || a.email)[0]?.toUpperCase()}
                                      </span>
                                    )}
                                    <span className="min-w-0">
                                      <span className="block truncate">{who || "—"}</span>
                                      {a.firstName && (
                                        <span className="label block truncate text-silverfaint">{a.firstName}</span>
                                      )}
                                    </span>
                                  </span>
                                </td>
                                <td className={`${td} text-[0.875rem] break-all text-silverdim`}>
                                  {a.email}
                                </td>
                                <td className={`${td} ${num} text-[0.875rem] whitespace-nowrap text-silverdim`}>
                                  {a.age ?? "—"}
                                </td>
                                <td className={`${td} text-[0.875rem] whitespace-nowrap text-silverfaint`}>
                                  {when(a.createdAt)}
                                </td>
                                <td className={td}>
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

                              {open && (
                                <tr className="bg-void">
                                  <td colSpan={5} className="border-t border-linesoft p-4 sm:p-5">
                                    <div className="flex flex-col gap-6 lg:flex-row">
                                      {/* ------------------------ the person -- */}
                                      <div className="flex shrink-0 gap-4 sm:flex-col lg:w-64">
                                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-linehi bg-ink2">
                                          {pic ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={pic} alt="" className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="flex h-full items-center justify-center">
                                              <span className="font-display text-[1.5rem] text-silverfaint">
                                                {(a.name.trim() || a.email)[0]?.toUpperCase()}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                        <dl className="min-w-0 flex-1 border border-line">
                                          {[
                                            ["INSTAGRAM", atHandle(a.instagram) || "—"],
                                            ["FIRST NAME", a.firstName || "—"],
                                            ["EMAIL", a.email],
                                            ["PHONE", a.phone || "—"],
                                            ["AGE (STATED)", a.age === null ? "—" : String(a.age)],
                                            ["BORN (VERIFIED)", a.birthYear ? String(a.birthYear) : "—"],
                                            ["JOINED", when(a.createdAt)],
                                          ].map(([k, v]) => (
                                            <div key={k} className="label flex items-baseline justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
                                              <dt className="text-silverfaint">{k}</dt>
                                              <dd className="min-w-0 text-right break-all text-chalk">{v}</dd>
                                            </div>
                                          ))}
                                        </dl>

                                        {a.verified && (
                                          <div className="mt-3">
                                            {/* Sends them back through the check. The
                                                function stamps a reset time so their
                                                own phone's copy of "verified" stops
                                                counting too - without that this would
                                                change the badge here and nothing at
                                                their end. */}
                                            <button
                                              type="button"
                                              disabled={resetting !== null}
                                              onClick={(ev) => {
                                                ev.stopPropagation();
                                                if (
                                                  window.confirm(
                                                    `Reset the age check for ${who || a.email}? They will have to send their ID again before they can RSVP.`,
                                                  )
                                                ) {
                                                  void resetCheck(a.id);
                                                }
                                              }}
                                              className="label min-h-11 w-full border border-line px-3 text-silverdim transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi disabled:opacity-50"
                                            >
                                              {resetting === a.id ? "RESETTING…" : "RESET AGE CHECK"}
                                            </button>
                                            {resetError?.id === a.id && (
                                              <p className="label mt-2 leading-loose text-bloodhi" role="alert">
                                                {resetError.message}
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {/* ------------------------ their checks -- */}
                                      <div className="min-w-0 flex-1">
                                        <p className="label border-b border-line pb-2 text-silverfaint">
                                          AGE CHECKS{" "}
                                          <span className="text-chalk">
                                            {load?.kind === "ready" ? load.rows.length : "…"}
                                          </span>
                                        </p>

                                        <div className="mt-3">
                                          {(!load || load.kind === "loading") && (
                                            <Waiting what="READING THEIR CHECKS…" />
                                          )}
                                          {load?.kind === "error" && (
                                            <Failed message={load.message} onRetry={() => {
                                              setChecks((c) => { const n = { ...c }; delete n[a.id]; return n; });
                                              void openRow(a.id);
                                              setOpenAccount(a.id);
                                            }} />
                                          )}
                                          {load?.kind === "ready" && load.rows.length === 0 && (
                                            <Empty>Nothing filed. They have not run the age check yet.</Empty>
                                          )}
                                          {load?.kind === "ready" && load.rows.length > 0 && (
                                            <ul className="flex flex-col gap-3">
                                              {load.rows.map((v) => {
                                                const doc = docs[v.id];
                                                const documentPath = v.documentPath;
                                                return (
                                                  <li key={v.id} className="border border-line bg-ink p-3">
                                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                                      <span className="label text-chalk">
                                                        {v.method === "barcode" ? "LICENCE SCAN" : (v.documentKind ?? "DOCUMENT").toUpperCase()}
                                                      </span>
                                                      <span
                                                        className={`label border px-2 py-1 ${
                                                          v.status === "approved"
                                                            ? "border-linehi text-chalk"
                                                            : v.status === "rejected"
                                                              ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
                                                              : "border-line text-silverdim"
                                                        }`}
                                                      >
                                                        {v.status.toUpperCase()}
                                                      </span>
                                                    </div>
                                                    <p className="label mt-1.5 text-silverfaint">
                                                      {when(v.createdAt)}
                                                      {v.birthYear ? ` · BORN ${v.birthYear}` : ""}
                                                    </p>
                                                    {v.note && (
                                                      <p className="mt-2 text-[0.875rem] leading-relaxed text-silverdim">{v.note}</p>
                                                    )}

                                                    {documentPath ? (
                                                      <div className="mt-2">
                                                        <button
                                                          type="button"
                                                          onClick={() => void showDocument(v.id, documentPath)}
                                                          className="label inline-flex min-h-11 items-center text-silverfaint underline decoration-line underline-offset-4 transition-colors hover:text-chalk hover:decoration-silverdim"
                                                        >
                                                          {doc?.kind === "ready" ? "RELOAD ID PHOTO" : "SHOW ID PHOTO"}
                                                        </button>
                                                        {doc?.kind === "loading" && (
                                                          <p className="label animate-pulse text-silverfaint">FETCHING A SIGNED LINK…</p>
                                                        )}
                                                        {doc?.kind === "error" && (
                                                          <p className="label text-bloodhi" role="alert">
                                                            COULD NOT OPEN IT. THE FILE IS MISSING, OR STORAGE REFUSED THE READ.
                                                          </p>
                                                        )}
                                                        {doc?.kind === "ready" && (
                                                          <div className="mt-2">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                              src={doc.url}
                                                              alt={`ID on file for ${a.email}`}
                                                              className="max-h-[60vh] w-full border border-line bg-void object-contain"
                                                            />
                                                            <p className="label mt-2 text-silverfaint">
                                                              THIS LINK DIES AFTER A MINUTE. RELOAD IT IF THE IMAGE GOES BLANK.
                                                            </p>
                                                          </div>
                                                        )}
                                                      </div>
                                                    ) : (
                                                      <p className="label mt-2 text-silverfaint">NO PHOTO ON THIS ONE</p>
                                                    )}
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
            </Panel>
          )}

          {tab === "review" && (
            <Panel>
              {/* The count is the headline of this tab - it is a job, not a
                  fact - so it keeps its display-sized number rather than being
                  folded into a PanelHead pill like the other counts. */}
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <p className="label tracking-[0.11em] text-silverdim uppercase">
                    Waiting on you
                  </p>
                  <p className="mt-1.5 text-[0.875rem] leading-relaxed text-silverfaint">
                    Every check is read by a person. Nothing is approved automatically.
                  </p>
                </div>
                <span
                  className={`font-display shrink-0 text-[2.75rem] leading-none tabular-nums ${
                    queue.kind === "error"
                      ? "text-bloodhi"
                      : pending
                        ? "text-chalk"
                        : "text-silverfaint"
                  }`}
                >
                  {queue.kind === "ready" ? pending : queue.kind === "error" ? "?" : "…"}
                </span>
              </div>

              {queue.kind === "ready" && queue.rows.length > 0 && (
                <div className="border-b border-linesoft px-5 py-3">
                  <input
                    value={reviewQuery}
                    onChange={(ev) => setReviewQuery(ev.target.value)}
                    placeholder="Find a name, handle or email…"
                    aria-label="Search the age-check queue"
                    className={`${field} w-full`}
                  />
                </div>
              )}

              {queue.kind === "loading" && (
                <PanelBody>
                  <Waiting what="READING THE QUEUE…" />
                </PanelBody>
              )}
              {queue.kind === "error" && (
                <PanelBody>
                  <Failed message={queue.message} onRetry={retryQueue} />
                </PanelBody>
              )}
              {queue.kind === "ready" &&
                (queue.rows.length === 0 ? (
                  <PanelBody>
                    <Empty>
                      The queue loaded and it is empty. Nobody is waiting on an
                      age check.
                    </Empty>
                  </PanelBody>
                ) : shownQueue.length === 0 ? (
                  <PanelBody>
                    <Empty>Nobody waiting matches that.</Empty>
                  </PanelBody>
                ) : (
                  <ul>
                    {shownQueue.map((v) => {
                      const doc = docs[v.id];
                      const working = busy?.id === v.id ? busy.status : null;
                      // Bound to a const so the handler below closes over a path
                      // that is known to exist rather than a nullable field.
                      const documentPath = v.documentPath;
                      return (
                        <li key={v.id} className="border-b border-line px-4 py-4 last:border-b-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-[1.0625rem] text-chalk">
                                {v.profile
                                  ? displayName(v.profile.name, v.profile.instagram) || "No name on file"
                                  : "Name did not load"}
                              </span>
                              {v.profile?.firstName && (
                                <span className="label block text-silverfaint">{v.profile.firstName}</span>
                              )}
                            </span>
                            <span className="label border border-line px-2 py-1 text-silverfaint">
                              {v.method === "barcode" ? "LICENCE SCAN" : (v.documentKind ?? "DOCUMENT").toUpperCase()}
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

                          {/* The two ages side by side, because that is the whole
                              review: what they claimed at sign-up, what they typed
                              on the form, and the card in the photo below has to
                              agree with both. */}
                          <p className="label mt-2 text-silverfaint">
                            STATED AGE {v.profile?.age ?? "—"} · DOB YEAR ON THE FORM{" "}
                            {v.birthYear ?? "—"} · SUBMITTED {when(v.createdAt)}
                          </p>

                          {/* Gated on documentPath alone, never on `method` - a
                              guest chooses what method a row claims to be, and a
                              row with no file behind it must never look the same
                              as one waiting on a signed link. See the account
                              roster's identical check a few hundred lines up. */}
                          {documentPath ? (
                            <div className="mt-2">
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
                                    className="max-h-[60vh] w-full border border-line bg-void object-contain"
                                  />
                                  <p className="label mt-2 text-silverfaint">
                                    THIS LINK DIES AFTER A MINUTE. RELOAD IT IF THE
                                    IMAGE GOES BLANK.
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            // Loud rather than absent: a row with no photo behind
                            // it should never read the same as one that simply has
                            // not been opened yet, since the only thing standing
                            // between this and an approval is somebody reading it.
                            <p
                              className="label mt-3 border border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.06)] px-3 py-2 leading-loose text-bloodhi"
                              role="alert"
                            >
                              NO PHOTO ON FILE FOR THIS CHECK - THERE IS NOTHING HERE
                              TO APPROVE AGAINST.
                            </p>
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
            </Panel>
          )}

          {/* ---------------------------------------------------------- door -- */}
          {tab === "door" && (
            <Panel>
              <PanelHead
                title="Scanned on this device"
                count={scans.length}
                sub="Point a camera at a ticket QR to open it and mark it used. This list is only on this phone."
                right={
                  scans.length > 0 ? (
                    <button
                      onClick={clearScans}
                      className="label flex min-h-9 items-center border border-line px-3 tracking-[0.11em] text-silverdim uppercase transition-colors hover:border-[rgba(200,16,46,0.45)] hover:text-bloodhi"
                    >
                      Clear
                    </button>
                  ) : undefined
                }
              />

              {scans.length === 0 ? (
                <PanelBody>
                  <Empty>Nothing scanned on this phone yet.</Empty>
                </PanelBody>
              ) : (
                <>
                  <ul>
                    {scans.map(([code, at]) => (
                      <li
                        key={code}
                        className="label flex items-baseline justify-between gap-4 border-t border-linesoft px-5 py-3 transition-colors hover:bg-ink2/50"
                      >
                        <span className="break-all text-chalk">{code}</span>
                        <span className="shrink-0 whitespace-nowrap text-silverfaint">
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
                </>
              )}
            </Panel>
          )}

          {tab === "raffle" && <RaffleAdmin />}

          <Link
            href="/"
            className="label block py-2 text-center tracking-[0.11em] text-silverfaint uppercase transition-colors hover:text-chalk lg:text-left"
          >
            &larr; Back to the site
          </Link>
        </div>
      </div>
    </main>
  );
}
