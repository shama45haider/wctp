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
import { readOwnProfile, type OwnProfile } from "./profile-data";

/**
 * Client-only demo account layer.
 *
 * State lives in localStorage - there is no server, no network call and no real
 * credential anywhere. Modelled as an external store so React reads it through
 * useSyncExternalStore: no setState-in-effect, no hydration mismatch, and tabs
 * stay in sync for free.
 *
 * Swap this module for Supabase auth when the backend lands; the hook API is
 * meant to survive that change. `placeOrder` is the seam where a real payment
 * intent and a server-issued order would go.
 */

/** One admission. A table ticket is a single pass that admits its whole party. */
export type Pass = {
  code: string;
  tierId: string;
  tierName: string;
  admits: number;
  /** Face value of this ticket, before fees. */
  priceCents: number;
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

export type DemoUser = {
  name: string;
  email: string;
  instagram?: string;
  phone?: string;
  verified: boolean;
  /** Year only - a full birth date is never retained. */
  birthYear?: number;
  /**
   * Epoch ms of the scan that set `verified` on this device. Compared against
   * the profile's verification_reset_at: a reset newer than this wins, one
   * older does not. Absent on records from before this existed, which are
   * treated as older than any reset.
   */
  verifiedAt?: number;
};

type Snapshot = {
  ready: boolean;
  user: DemoUser | null;
  cart: Cart | null;
  orders: Order[];
};

const USER_KEY = "wctp.demo.user";
const CART_KEY = "wctp.demo.cart";
const ORDERS_KEY = "wctp.demo.orders";
/** Single-ticket RSVPs from before tiers existed. Cleared, never migrated. */
const LEGACY_TICKETS_KEY = "wctp.demo.tickets";

const NO_ORDERS: Order[] = [];
const EMPTY: Snapshot = {
  ready: false,
  user: null,
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
    user: read<DemoUser | null>(USER_KEY, null),
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
    } catch {
      /* nothing to clean up */
    }
    snapshot = load();
    queueMicrotask(emit);
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === USER_KEY || e.key === CART_KEY || e.key === ORDERS_KEY) {
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
  if ("user" in next) write(USER_KEY, snapshot.user);
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
    user: localUser,
    cart,
    orders: localOrders,
  } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * The session is the account, once there is one to have.
   *
   * These two used to be separate people. Signing in wrote a Supabase session
   * while the ticket flow went on reading a localStorage record that signing
   * in never touched, so a signed-in guest was sent back to the sign-in page
   * the moment they picked a ticket. The session wins wherever it exists; the
   * localStorage record is what a build with no credentials falls back to.
   *
   * Name and age check still come from the local record, because the ID scan
   * writes them and has nowhere else to put them until orders move into the
   * database. An email makes a poor name, so it is only the fallback.
   */
  const auth = useSupabaseAuth();

  /**
   * The profile row behind the session.
   *
   * `verified` is decided in the database - an admin approving an ID sets it
   * through the trigger in 0002, and a check done on another phone sets it
   * there too - so reading it only out of this browser meant someone whose ID
   * had genuinely been approved still met the gate at checkout. Null while it
   * is being read, and null forever if it cannot be, which is why the two are
   * ORed below rather than one preferred: a profile that will not load must
   * never un-verify somebody this device already saw verified.
   */
  const [dbProfile, setDbProfile] = useState<OwnProfile | null>(null);

  /**
   * Whether this device's own check still counts.
   *
   * The OR with the database exists so a scan clears the gate before the
   * database has heard about it. An admin reset would never win against that
   * on its own - the phone would keep saying yes forever - so the reset is
   * stamped, and any local check older than the stamp is dropped. A record
   * from before verifiedAt existed has no stamp and reads as older than any
   * reset, which is the right way round: it cannot have been done after one.
   */
  const resetAt = dbProfile?.verificationResetAt
    ? Date.parse(dbProfile.verificationResetAt)
    : null;
  const localStillVerified =
    Boolean(localUser?.verified) &&
    (resetAt === null || (localUser?.verifiedAt ?? 0) > resetAt);

  // Once a reset is known to have overtaken the local check, clear the local
  // record too, so /verify and /account stop showing a tick the site is not
  // honouring. An effect, not a render-time write.
  useEffect(() => {
    if (!localUser?.verified || localStillVerified) return;
    if (!snapshot.user) return;
    patch({
      user: { ...snapshot.user, verified: false, verifiedAt: undefined, birthYear: undefined },
    });
  }, [localUser?.verified, localStillVerified]);

  const user: DemoUser | null = isSupabaseConfigured
    ? auth.user
      ? {
          ...localUser,
          email: auth.user.email,
          name:
            localUser?.name || dbProfile?.name || auth.user.email.split("@")[0],
          instagram: localUser?.instagram ?? dbProfile?.instagram ?? undefined,
          phone: localUser?.phone ?? dbProfile?.phone ?? undefined,
          birthYear: localUser?.birthYear ?? dbProfile?.birthYear ?? undefined,
          verified: Boolean(dbProfile?.verified || localStillVerified),
        }
      : null
    : localUser;

  // Both must have answered. Reporting ready while the session is still
  // unknown shows the signed-out screen to somebody who is signed in.
  const ready = storeReady && (!isSupabaseConfigured || auth.ready);

  /**
   * Orders placed on other devices.
   *
   * orders/order_lines/passes have existed since the schema was first written
   * for exactly this, and nothing ever wrote to them - placeOrder only ever
   * touched localStorage, so a ticket bought on a phone was invisible on a
   * laptop signed into the same account. This fetches what the database has;
   * placeOrder below writes to it.
   *
   * null means "not fetched yet", not "no orders" - the merge below falls back
   * to the local list while it is null, so a signed-in guest is never shown an
   * empty order history for the few hundred milliseconds before this answers.
   */
  const [dbOrders, setDbOrders] = useState<Order[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const userId = auth.user?.id;

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setDbOrders(null);
      setOrdersError(null);
      return;
    }
    let live = true;
    (async () => {
      const { orders: rows, error } = await listOrders(userId);
      if (!live) return;
      setDbOrders(rows);
      setOrdersError(error ?? null);
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      setDbProfile(null);
      return;
    }
    let live = true;
    void readOwnProfile(userId).then((p) => {
      if (live) setDbProfile(p);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  /**
   * Backfill.
   *
   * An order placed before syncing existed lives only in this browser. One
   * whose lines failed to write - 0004 unrun at the time - sits in the
   * database with no tickets on it. Either way the dashboard cannot see a
   * ticket the guest can, and "I got my ticket but I am not on the list" is
   * exactly what that looks like from the other side. Each is pushed once per
   * id per session; syncOrder upserts the row and tolerates duplicate lines,
   * so repeating it against one that half-landed is safe.
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
        else setOrdersError(out.error ?? "An order did not sync.");
      }
      if (!landed) return;
      const { orders: rows, error } = await listOrders(userId);
      if (!live) return;
      setDbOrders(rows);
      if (error) setOrdersError(error);
    })();
    return () => {
      live = false;
    };
  }, [userId, dbOrders, localOrders]);

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

  const signUp = useCallback(
    (u: { name: string; email: string; instagram?: string }) =>
      patch({ user: { ...u, verified: false } }),
    [],
  );

  const signIn = useCallback((email: string) => {
    const existing = snapshot.user;
    patch({
      user:
        existing?.email === email
          ? existing
          : { name: email.split("@")[0], email, verified: false },
    });
  }, []);

  const signInAsDemo = useCallback(
    () =>
      patch({
        user: {
          name: "Demo Guest",
          email: "demo@wecametooparty.com",
          instagram: "@demoguest",
          phone: "(212) 555-0139",
          verified: true,
          birthYear: 2001,
        },
      }),
    [],
  );

  /**
   * Ends the session as well as the local record.
   *
   * Clearing localStorage alone would leave the Supabase session standing, and
   * the user derived above would come straight back from it - a sign-out button
   * that empties the cart and changes nothing else.
   */
  const authSignOut = auth.signOut;
  const signOut = useCallback(async () => {
    patch({ user: null, cart: null, orders: NO_ORDERS });
    if (isSupabaseConfigured) await authSignOut();
  }, [authSignOut]);

  /**
   * Records the outcome of the age check.
   *
   * Only the birth year and, when a scan supplied one, the name on the card.
   * A licence barcode also carries an address, a document number and a full
   * date of birth; none of that is kept. A door needs to know someone is over
   * 18 and what to call them, and anything stored beyond that is only ever a
   * liability - the more so here, where it would sit in localStorage.
   */
  /**
   * Records the outcome of the age check.
   *
   * snapshot.user can be null here even for someone genuinely signed in: since
   * the session became the source of identity, nothing writes a local record
   * on sign-in any more, so a guest who has never touched anything else on
   * /account arrives with no local user to update. This used to bail out
   * silently in exactly that case - the scan still ran and computed the right
   * answer, it just had nowhere to save it, which read as "I submitted my ID
   * and it does not save" with no error anywhere to explain why. It now
   * starts a local record from the session's email rather than requiring one
   * to already exist.
   */
  const markVerified = useCallback(
    (birthYear: number, legalName?: string) => {
      const base: DemoUser | null =
        snapshot.user ??
        (auth.user
          ? { name: auth.user.email.split("@")[0], email: auth.user.email, verified: false }
          : null);
      if (!base) return;
      patch({
        user: {
          ...base,
          verified: true,
          verifiedAt: Date.now(),
          birthYear,
          name: legalName?.trim() || base.name,
        },
      });
    },
    [auth.user],
  );

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
          if (!out.ok) setOrdersError(out.error ?? "The order did not sync.");
        });
      }

      return order;
    },
    [],
  );

  const cancelOrder = useCallback(
    (id: string) => {
      patch({ orders: snapshot.orders.filter((o) => o.id !== id) });
      setDbOrders((rows) => (rows ? rows.filter((o) => o.id !== id) : rows));
      if (isSupabaseConfigured && userId) {
        void cancelOrderInDb(id).then((out) => {
          if (!out.ok) setOrdersError(out.error ?? "The cancellation did not sync.");
        });
      }
    },
    [userId],
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
    signUp,
    signIn,
    signInAsDemo,
    signOut,
    markVerified,
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
