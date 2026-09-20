"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  findPromo,
  linesFromCart,
  maxSelectable,
  tiersFor,
  totalsFor,
  type Cart,
  type OrderLine,
} from "./tickets";
import { isSupabaseConfigured } from "./supabase";
import { useSupabaseAuth } from "./supabase-auth";
import { cancelOrderInDb, listOrders, syncOrder } from "./orders-data";
import { useOwnProfile, type OwnCheck } from "./profile-data";

/**
 * The account, as the ticket flow sees it.
 *
 * Who is signed in comes from the Supabase session; what is known about them -
 * the handle, the age check - comes from their profile row. Neither is decided
 * here. This module owns the cart and the placed orders, which live in
 * localStorage so a half-built order survives the trip out to sign-in or the
 * age check and back, and are mirrored to the database so the same tickets
 * show up on another phone.
 *
 * The file keeps its old name so nothing importing it has to move.
 *
 * Modelled as an external store so React reads it through
 * useSyncExternalStore: no setState-in-effect, no hydration mismatch, and tabs
 * stay in sync for free.
 */

/** One admission. A table ticket is a single pass that admits its whole party. */
export type Pass = {
  code: string;
  tierId: string;
  tierName: string;
  admits: number;
  /** Face value of this ticket, before fees. */
  priceCents: number;
  /**
   * When a door scanned this in, or null. The only evidence the site has that
   * somebody actually turned up, as opposed to having bought a ticket - which
   * is the difference between "went to" and "meant to go to".
   */
  usedAt?: string | null;
};

export type Buyer = {
  name: string;
  email: string;
  phone?: string;
};

export type Order = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  lines: OrderLine[];
  promoCode?: string;
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  buyer: Buyer;
  passes: Pass[];
  createdAt: string;
};

export type AccountUser = {
  id: string;
  /**
   * The Instagram handle without the @, which is what every account is
   * called. Falls back to the email's local part for an account from before
   * handles were required, until they add one on /profile.
   */
  name: string;
  firstName: string | null;
  /** What they said at sign-up. Not the reviewed year - see `birthYear`. */
  age: number | null;
  email: string;
  /** Handle without the @, or null on a legacy account. */
  instagram: string | null;
  phone: string | null;
  /**
   * Cleared by an admin reading their ID, and by nothing else. False until the
   * profile has been read - check `profileLoaded` before acting on a false.
   */
  verified: boolean;
  /** Year only, and only once a review approved it. */
  birthYear: number | null;
  /** The newest age check they have filed, or null if none. */
  check: OwnCheck | null;
  /**
   * True once the profile row has been read, or the read has given up. Until
   * then `verified`, `check` and `name` are placeholders.
   */
  profileLoaded: boolean;
};

type Snapshot = {
  ready: boolean;
  cart: Cart | null;
  orders: Order[];
};

const CART_KEY = "wctp.demo.cart";
const ORDERS_KEY = "wctp.demo.orders";
/** Single-ticket RSVPs from before tiers existed. Cleared, never migrated. */
const LEGACY_TICKETS_KEY = "wctp.demo.tickets";
/**
 * The local account record from before the session was the account. It could
 * carry a "verified" flag that this browser had granted itself; nothing reads
 * it any more, and it is cleared so it cannot be mistaken for anything.
 */
const LEGACY_USER_KEY = "wctp.demo.user";

const NO_ORDERS: Order[] = [];
const EMPTY: Snapshot = {
  ready: false,
  cart: null,
  orders: NO_ORDERS,
};

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
    /* private mode or blocked storage - state just will not persist */
  }
};

function load(): Snapshot {
  return {
    ready: true,
    cart: read<Cart | null>(CART_KEY, null),
    orders: read<Order[]>(ORDERS_KEY, NO_ORDERS),
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  // First subscriber pulls storage in. Runs after mount, so the server and the
  // client both render the `ready: false` snapshot on first paint.
  if (!hydrated) {
    hydrated = true;
    try {
      window.localStorage.removeItem(LEGACY_TICKETS_KEY);
      window.localStorage.removeItem(LEGACY_USER_KEY);
    } catch {
      /* nothing to clean up */
    }
    snapshot = load();
    queueMicrotask(emit);
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === CART_KEY || e.key === ORDERS_KEY) {
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

function patch(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  if ("cart" in next) write(CART_KEY, snapshot.cart);
  if ("orders" in next) write(ORDERS_KEY, snapshot.orders);
  emit();
}

const rand = (n: number) =>
  Array.from({ length: n }, () =>
    "ABCDEFGHJKMNPQRSTUVWXYZ23456789".charAt(Math.floor(Math.random() * 31)),
  ).join("");

// Ambiguous glyphs (0/O, 1/I/L) are left out of the alphabet above so a code
// read aloud at a loud door, or typed in from a screenshot, survives the trip.
const makeOrderId = () => `WCTP-${rand(6)}`;

export function useAccount() {
  const {
    ready: storeReady,
    cart,
    orders: localOrders,
  } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const auth = useSupabaseAuth();
  const userId = auth.user?.id;

  /**
   * The profile row behind the session. `verified` is decided there and only
   * there; an admin approving an ID sets it through the trigger in 0002 and a
   * reset clears it through 0010. Re-read on demand - after an age check is
   * filed, after the profile is saved - so a gate never argues with the
   * database.
   */
  const { profile, loaded: profileLoaded, reload: refreshProfile } = useOwnProfile(userId);

  const authUser = auth.user;
  const user: AccountUser | null = useMemo(() => {
    if (!authUser) return null;
    return {
      id: authUser.id,
      email: authUser.email,
      name: profile?.name || profile?.instagram || authUser.email.split("@")[0],
      firstName: profile?.firstName ?? null,
      age: profile?.age ?? null,
      instagram: profile?.instagram ?? null,
      phone: profile?.phone ?? null,
      verified: Boolean(profile?.verified),
      birthYear: profile?.birthYear ?? null,
      check: profile?.latestCheck ?? null,
      profileLoaded,
    };
  }, [authUser, profile, profileLoaded]);

  /**
   * All three must have answered: the store, the session, and - when there is
   * a session - the profile behind it. Reporting ready before the profile has
   * landed would send a verified guest to the age check.
   */
  const ready =
    storeReady && (!isSupabaseConfigured || (auth.ready && (!authUser || profileLoaded)));

  /**
   * Orders placed on other devices, keyed by the user they were read for.
   *
   * Keyed rather than cleared on sign-out: a different person signing in on
   * the same phone must not see the previous account's tickets for the few
   * hundred milliseconds before their own read lands, and keying the answer
   * by id makes a stale one unreadable instead of relying on an effect to
   * wipe it in time. `rows` null means "not fetched yet", not "no orders" -
   * the merge below falls back to the local list while it is null, so a
   * signed-in guest is never shown an empty order history before this answers.
   */
  const [db, setDb] = useState<{
    id: string;
    rows: Order[] | null;
    error: string | null;
  } | null>(null);
  const mine = userId && db?.id === userId ? db : null;
  const dbOrders = mine?.rows ?? null;
  const ordersError = mine?.error ?? null;

  /** An error against the current account, leaving whatever rows were read. */
  const noteOrdersError = useCallback(
    (message: string) => {
      if (!userId) return;
      setDb((d) =>
        d && d.id === userId
          ? { ...d, error: message }
          : { id: userId, rows: null, error: message },
      );
    },
    [userId],
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return;
    let live = true;
    (async () => {
      const { orders: rows, error } = await listOrders(userId);
      if (!live) return;
      setDb({ id: userId, rows, error: error ?? null });
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  /**
   * Backfill.
   *
   * An order placed before syncing existed lives only in this browser. One
   * whose lines failed to write sits in the database with no tickets on it.
   * Either way the dashboard cannot see a ticket the guest can. Each is pushed
   * once per id per session; syncOrder upserts the row and tolerates duplicate
   * lines, so repeating it against one that half-landed is safe.
   */
  const pushed = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isSupabaseConfigured || !userId || dbOrders === null) return;

    const inDb = new Map(dbOrders.map((o) => [o.id, o]));
    const stale = localOrders.filter((o) => {
      if (pushed.current.has(o.id)) return false;
      const db = inDb.get(o.id);
      return !db || (db.lines.length === 0 && o.lines.length > 0);
    });
    if (stale.length === 0) return;
    stale.forEach((o) => pushed.current.add(o.id));

    let live = true;
    (async () => {
      let landed = false;
      for (const o of stale) {
        const out = await syncOrder(o, userId);
        if (!live) return;
        if (out.ok) landed = true;
        else noteOrdersError(out.error ?? "An order did not sync.");
      }
      if (!landed) return;
      const { orders: rows, error } = await listOrders(userId);
      if (!live) return;
      // A clean re-read keeps any earlier sync error on screen: the rows are
      // right, but something still did not land.
      setDb((d) => ({
        id: userId,
        rows,
        error: error ?? (d?.id === userId ? d.error : null),
      }));
    })();
    return () => {
      live = false;
    };
  }, [userId, dbOrders, localOrders, noteOrdersError]);

  // The database copy is the one other devices can see, so it wins on a
  // shared id - a door marking a pass used should show up here. Anything only
  // in localStorage is an order this device has not finished syncing yet.
  const orders = useMemo(() => {
    if (!isSupabaseConfigured || !userId) return localOrders;
    const base = dbOrders ?? [];
    const seen = new Set(base.map((o) => o.id));
    return [...base, ...localOrders.filter((o) => !seen.has(o.id))].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [localOrders, dbOrders, userId]);

  /**
   * Ends the session as well as the local state.
   *
   * Clearing localStorage alone would leave the Supabase session standing, and
   * the user derived above would come straight back from it.
   */
  const authSignOut = auth.signOut;
  const signOut = useCallback(async () => {
    patch({ cart: null, orders: NO_ORDERS });
    if (isSupabaseConfigured) await authSignOut();
  }, [authSignOut]);

  /**
   * Sets the quantity of one tier.
   *
   * Selecting from a different event replaces the cart rather than merging:
   * every order belongs to a single night, so there is no such thing as a
   * basket spanning two doors.
   */
  const setQty = useCallback(
    (eventSlug: string, tierId: string, qty: number) => {
      const base: Cart =
        snapshot.cart?.eventSlug === eventSlug
          ? snapshot.cart
          : { eventSlug, qty: {} };
      const next: Cart = {
        ...base,
        qty: { ...base.qty, [tierId]: Math.max(0, qty) },
      };
      patch({
        cart: Object.values(next.qty).some((n) => n > 0) ? next : null,
      });
    },
    [],
  );

  /**
   * Moves a tier's quantity by a delta, clamped to what is actually buyable.
   *
   * Steppers go through here rather than through `setQty` with a number they
   * computed at render time: two taps inside one frame both read the same
   * stale quantity, and the second silently undoes the first.
   */
  const adjustQty = useCallback(
    (eventSlug: string, tierId: string, delta: number) => {
      const tier = tiersFor(eventSlug).find((t) => t.id === tierId);
      if (!tier) return;
      const current =
        snapshot.cart?.eventSlug === eventSlug
          ? (snapshot.cart.qty[tierId] ?? 0)
          : 0;
      setQty(
        eventSlug,
        tierId,
        Math.min(maxSelectable(tier), Math.max(0, current + delta)),
      );
    },
    [setQty],
  );

  /**
   * Sets (or clears, with null) the donation amount on a tier.
   *
   * The amount lives beside the quantities in the cart rather than in local
   * component state, for the same reason the quantities do: it has to survive
   * the trip to checkout.
   */
  const setDonation = useCallback(
    (eventSlug: string, tierId: string, cents: number | null) => {
      const base: Cart =
        snapshot.cart?.eventSlug === eventSlug
          ? snapshot.cart
          : { eventSlug, qty: {} };
      const next: Cart = {
        ...base,
        qty: { ...base.qty, [tierId]: cents && cents > 0 ? 1 : 0 },
        amounts: { ...base.amounts, [tierId]: Math.max(0, cents ?? 0) },
      };
      patch({
        cart: Object.values(next.qty).some((n) => n > 0) ? next : null,
      });
    },
    [],
  );

  const setPromoCode = useCallback((code: string | null) => {
    if (!snapshot.cart) return;
    patch({
      cart: { ...snapshot.cart, promoCode: code?.toUpperCase() || undefined },
    });
  }, []);

  const clearCart = useCallback(() => patch({ cart: null }), []);

  /**
   * Turns the cart into an order and issues a pass per ticket.
   *
   * Priced from live inventory at this moment, not from whatever the cart was
   * worth when it was built - the same reason a real checkout reprices on
   * submit rather than trusting the client's total.
   */
  const placeOrder = useCallback(
    (buyer: Buyer, eventTitle: string): Order | null => {
      const cart = snapshot.cart;
      const lines = linesFromCart(cart);
      if (!cart || lines.length === 0) return null;

      const promo = cart.promoCode ? findPromo(cart.promoCode) : null;
      const t = totalsFor(lines, promo);
      const id = makeOrderId();

      // Donations buy nobody entry, so they issue no pass. An order that is
      // only a donation is a receipt, not a ticket.
      const passes: Pass[] = lines
        .filter((l) => !l.donation)
        .flatMap((l) =>
          Array.from({ length: l.qty }, (_, i) => ({
            code: `${id}-${l.tierId.slice(0, 2).toUpperCase()}${i + 1}`,
            tierId: l.tierId,
            tierName: l.tierName,
            admits: l.admits,
            priceCents: l.unitCents,
          })),
        );

      const order: Order = {
        id,
        eventSlug: cart.eventSlug,
        eventTitle,
        lines,
        promoCode: promo?.code,
        subtotalCents: t.subtotalCents,
        discountCents: t.discountCents,
        feeCents: t.feeCents,
        totalCents: t.totalCents,
        buyer,
        passes,
        createdAt: new Date().toISOString(),
      };

      patch({ cart: null, orders: [order, ...snapshot.orders] });

      // Fire and forget. The confirmation on screen is already correct without
      // this - it is what makes the same order visible on another device, not
      // what makes this one work. A failure here is surfaced the next time
      // /account fetches, not blocked on now.
      if (isSupabaseConfigured && userId) {
        void syncOrder(order, userId).then((out) => {
          if (!out.ok) noteOrdersError(out.error ?? "The order did not sync.");
        });
      }

      return order;
    },
    [userId, noteOrdersError],
  );

  const cancelOrder = useCallback(
    (id: string) => {
      patch({ orders: snapshot.orders.filter((o) => o.id !== id) });
      setDb((d) =>
        d && d.id === userId && d.rows
          ? { ...d, rows: d.rows.filter((o) => o.id !== id) }
          : d,
      );
      if (isSupabaseConfigured && userId) {
        void cancelOrderInDb(id).then((out) => {
          if (!out.ok) noteOrdersError(out.error ?? "The cancellation did not sync.");
        });
      }
    },
    [userId, noteOrdersError],
  );

  const findOrder = useCallback(
    (id: string) => orders.find((o) => o.id === id) ?? null,
    [orders],
  );

  const lines = useMemo(() => linesFromCart(cart), [cart]);
  const passCount = useMemo(
    () => orders.reduce((n, o) => n + o.passes.length, 0),
    [orders],
  );

  return {
    ready,
    user,
    cart,
    /** The cart priced against current stock. Empty when there is no cart. */
    lines,
    orders,
    /** Set when an order placed elsewhere might not be showing here. The
     * orders that ARE visible are still correct - this is a "there may be
     * more" notice, not a load failure for the whole screen. */
    ordersError,
    passCount,
    /** Re-reads the profile row: call after filing an age check or saving the profile. */
    refreshProfile,
    signOut,
    setQty,
    adjustQty,
    setDonation,
    setPromoCode,
    clearCart,
    placeOrder,
    cancelOrder,
    findOrder,
  };
}
