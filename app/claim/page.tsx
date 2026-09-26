"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { atHandle } from "@/lib/handle";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { findOrderByCode, redeemOrder, type StoreOrder } from "@/lib/store";
import { usd } from "@/lib/tickets";
import { btn, btnGo } from "@/lib/ui";
import PrizeQr from "@/components/PrizeQr";

/**
 * Where a prize QR lands.
 *
 * Unlike /pass, this one looks the code up: a prize is money already taken,
 * so "handed over" has to be one fact in the database that every staff phone
 * agrees on, not a note on whichever handset scanned it first. Staff are
 * signed in to the dashboard account, see who bought what, and tap HAND OVER;
 * redeem_store_order() marks it in one statement, so two phones scanning the
 * same code at once can't both give a prize away.
 *
 * Anyone else who opens it - the buyer tapping their own QR - is told to show
 * it to staff, and sees the QR again if it's theirs.
 */

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => decodeURIComponent(window.location.hash.replace(/^#/, "")).trim().toUpperCase();
const noHash = () => null;

type Lookup =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "found"; order: StoreOrder };

function time(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

const shell = "mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,8vw,5rem)]";

export default function Claim() {
  const code = useSyncExternalStore(subscribeHash, readHash, noHash);
  const { ready, user, isAdmin } = useSupabaseAuth();
  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justNow, setJustNow] = useState(false);

  const load = useCallback(async (c: string) => {
    const res = await findOrderByCode(c);
    if (res.error) setLookup({ kind: "error", message: res.error });
    else if (!res.order) setLookup({ kind: "missing" });
    else setLookup({ kind: "found", order: res.order });
  }, []);

  useEffect(() => {
    if (!ready || !user || !code) return;
    let live = true;
    void findOrderByCode(code).then((res) => {
      if (!live) return;
      if (res.error) setLookup({ kind: "error", message: res.error });
      else if (!res.order) setLookup({ kind: "missing" });
      else setLookup({ kind: "found", order: res.order });
    });
    return () => {
      live = false;
    };
  }, [ready, user, code]);

  const handOver = async () => {
    if (!code) return;
    setBusy(true);
    setProblem(null);
    const res = await redeemOrder(code);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.error);
      return;
    }
    setJustNow(res.justRedeemed);
    await load(code);
  };

  if (code === null || !ready) {
    return (
      <main className={shell}>
        <p className="label animate-pulse text-silverfaint">READING PRIZE…</p>
      </main>
    );
  }

  if (!code) {
    return (
      <main className={`${shell} text-center`}>
        <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">Nothing to show</h1>
        <p className="mt-4 text-silverdim">Open this page by scanning a prize QR.</p>
        <Link href="/donate" className={`${btn} mt-8 w-full`}>
          The store
        </Link>
      </main>
    );
  }

  // Not signed in: the buyer, or a staff member who needs to sign in first.
  if (!user) {
    return (
      <main className={`${shell} text-center`}>
        <span className="label border border-[rgba(255,209,102,0.45)] px-3 py-2 text-prize">PRIZE PICKUP</span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Show this to staff
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          A staff member at the event scans your QR and hands your prize over. Staff: sign in with the
          dashboard account to see this order.
        </p>
        <Link href="/login" className={`${btn} mt-8 w-full`}>
          Staff sign in
        </Link>
      </main>
    );
  }

  if (lookup.kind === "loading") {
    return (
      <main className={shell}>
        <p className="label animate-pulse text-silverfaint">LOOKING UP {code}…</p>
      </main>
    );
  }

  if (lookup.kind === "error" || lookup.kind === "missing") {
    return (
      <main className={`${shell} text-center`}>
        <span className="label border border-[rgba(200,16,46,0.5)] px-3 py-2 text-bloodhi">
          {isAdmin ? "NOT FOUND" : "PRIZE PICKUP"}
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          {isAdmin ? "Do not hand over" : "Show this to staff"}
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {lookup.kind === "error"
            ? lookup.message
            : isAdmin
              ? `No prize has the code ${code}.`
              : "Staff scan this at the event to hand your prize over."}
        </p>
      </main>
    );
  }

  const o = lookup.order;
  const done = Boolean(o.redeemedAt);

  // The buyer opening their own QR: nothing to hand over from this phone.
  if (!isAdmin) {
    return (
      <main className={`${shell} text-center`}>
        <span className="label border border-[rgba(255,209,102,0.45)] px-3 py-2 text-prize">
          {done ? "COLLECTED" : "READY FOR PICKUP"}
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85] break-words">
          {o.qty > 1 ? `${o.qty} × ` : ""}
          {o.productName}
        </h1>
        {done ? (
          <p className="mt-4 text-silverdim">Handed over {time(o.redeemedAt!)}. Enjoy it.</p>
        ) : (
          <>
            <p className="mt-4 text-silverdim">Show this QR to a staff member at the next event.</p>
            <PrizeQr code={o.claimCode} className="mt-7" size={200} />
          </>
        )}
      </main>
    );
  }

  return (
    <main className={shell}>
      <span
        className={`label border px-3 py-2 ${
          done && !justNow
            ? "border-[rgba(200,16,46,0.5)] text-bloodhi"
            : "border-[rgba(255,209,102,0.45)] text-prize"
        }`}
      >
        {justNow ? "HANDED OVER" : done ? "ALREADY HANDED OVER" : "PAID · READY TO HAND OVER"}
      </span>

      <h1 className="font-display chrome mt-6 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85] break-words">
        {o.qty > 1 ? `${o.qty} × ` : ""}
        {o.productName}
      </h1>

      <dl className="mt-7 border-t border-line">
        {([
          ["BUYER", o.buyerName || "—"],
          ["INSTAGRAM", o.buyerHandle ? atHandle(o.buyerHandle) : "—"],
          ["EMAIL", o.buyerEmail || "—"],
          ["PHONE", o.buyerPhone || "—"],
          ["PAID", `${usd(o.amountCents)} · ${time(o.paidAt)}`],
          ["CODE", o.claimCode],
        ] as const).map(([k, v]) => (
          <div key={k} className="label flex items-baseline justify-between gap-4 border-b border-line py-3">
            <dt className="text-silverfaint">{k}</dt>
            <dd className="text-right break-all text-chalk">{v}</dd>
          </div>
        ))}
      </dl>

      {problem && (
        <p className="label mt-6 border border-[rgba(200,16,46,0.5)] px-3 py-3 leading-loose text-bloodhi" role="alert">
          {problem.toUpperCase()}
        </p>
      )}

      {done ? (
        <p
          className={`label mt-6 border px-3 py-3 leading-loose ${
            justNow ? "border-[rgba(255,209,102,0.45)] text-prize" : "border-[rgba(200,16,46,0.5)] text-bloodhi"
          }`}
        >
          {justNow ? "MARKED HANDED OVER AT" : "ALREADY HANDED OVER AT"} {time(o.redeemedAt!).toUpperCase()}
        </p>
      ) : (
        <button type="button" onClick={() => void handOver()} disabled={busy} className={`${btnGo} mt-7 w-full`}>
          {busy ? "Marking…" : "Hand it over"}
        </button>
      )}

      <Link href="/admin" className="label mt-6 block py-2 text-center text-silverfaint hover:text-chalk">
        &larr; DASHBOARD
      </Link>
    </main>
  );
}
