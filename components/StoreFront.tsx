"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { siteImageUrl } from "@/lib/site-content";
import {
  confirmStoreOrder,
  leftOf,
  listProducts,
  startStoreCheckout,
  STORE_CHANGED,
  type PaidPrize,
  type Product,
} from "@/lib/store";
import { usd } from "@/lib/tickets";
import { btn, btnGo } from "@/lib/ui";
import { Editable } from "./Editable";
import PrizeQr from "./PrizeQr";

/**
 * The shelf on the donate page: prizes an admin lists from the dashboard's
 * Store tab. Buying one goes through Stripe's own hosted page (the site never
 * sees a card) and Stripe emails an invoice. Coming back, the page confirms
 * the payment with store-order-status and shows the pickup QR right here - it
 * also lives on the buyer's account, so closing this is not losing it.
 *
 * The return from Stripe is read off the URL on mount, the same way
 * DonateForm reads its own: a full navigation away and back would have lost
 * anything kept in state.
 */

type Receipt =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "paid"; order: PaidPrize }
  | { kind: "failed"; error: string };

const MAX_QTY = 5;

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-silverfaint border-t-prize align-[-2px]"
    />
  );
}

function ProductCard({
  p,
  signedIn,
  busy,
  onBuy,
}: {
  p: Product;
  signedIn: boolean;
  busy: boolean;
  onBuy: (qty: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const left = leftOf(p);
  const soldOut = left === 0;
  const max = Math.max(1, Math.min(MAX_QTY, left ?? MAX_QTY));
  const img = siteImageUrl(p.imagePath);

  return (
    <article className="store-card group relative flex flex-col overflow-hidden border border-line bg-ink">
      <div className="relative aspect-[4/3] overflow-hidden bg-ink2 sm:aspect-square">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={p.name}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
              soldOut ? "opacity-40 grayscale" : ""
            }`}
          />
        ) : (
          <div className="hairline-x absolute inset-0 opacity-20" aria-hidden />
        )}
        <span className="store-tag font-display absolute top-3 left-3 px-2.5 py-1 text-[1.25rem] leading-none tabular-nums">
          {usd(p.priceCents)}
        </span>
        {soldOut ? (
          <span className="label absolute top-3 right-3 bg-blood px-2 py-1 text-chalk">SOLD OUT</span>
        ) : left !== null && left <= 5 ? (
          <span className="label absolute top-3 right-3 bg-void/85 px-2 py-1 text-prize">
            {left} LEFT
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col px-4 pt-4 pb-4">
        <h3 className="font-display text-[1.45rem] leading-tight break-words">{p.name}</h3>
        {p.blurb && (
          <p className="mt-2 text-[0.875rem] leading-relaxed text-silverdim">{p.blurb}</p>
        )}

        <div className="mt-auto pt-4">
          {soldOut ? (
            <button type="button" disabled className={`${btn} w-full`}>
              Sold out
            </button>
          ) : !signedIn ? (
            <Link href="/login" className={`${btn} w-full`}>
              Sign in to buy
            </Link>
          ) : (
            <div className="flex items-stretch gap-2">
              <div className="flex items-center border border-line" role="group" aria-label="Quantity">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1 || busy}
                  aria-label="One fewer"
                  className="flex h-11 w-9 items-center justify-center text-silverdim transition-colors hover:text-chalk disabled:opacity-40"
                >
                  &minus;
                </button>
                <span className="label w-5 text-center text-chalk tabular-nums" aria-live="polite">
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(max, q + 1))}
                  disabled={qty >= max || busy}
                  aria-label="One more"
                  className="flex h-11 w-9 items-center justify-center text-silverdim transition-colors hover:text-chalk disabled:opacity-40"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => onBuy(qty)}
                disabled={busy}
                className={`${btnGo} store-buy flex-1 gap-2`}
              >
                {busy ? <Spinner /> : null}
                {busy ? "To Stripe…" : `Buy · ${usd(p.priceCents * qty)}`}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function PrizeReceipt({ order, onClose }: { order: PaidPrize; onClose: () => void }) {
  return (
    <div className="store-receipt relative mt-8 overflow-hidden border border-[rgba(255,209,102,0.45)] bg-ink">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-prize to-transparent" />
      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:p-7">
        <PrizeQr code={order.claimCode} className="order-2 sm:order-1" />
        <div className="order-1 sm:order-2">
          <p className="label text-prize">
            <Editable k="store.receipt.eyebrow">PAID · YOUR PRIZE IS RESERVED</Editable>
          </p>
          <h2 className="font-display chrome mt-2 text-[clamp(1.75rem,6vw,2.5rem)] leading-[0.9] break-words">
            {order.qty > 1 ? `${order.qty} × ` : ""}
            {order.productName}
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            <Editable k="store.receipt.blurb">
              Show this QR to a staff member at the next event and they&rsquo;ll hand it over.
              It&rsquo;s saved on your account too, and Stripe has emailed your invoice.
            </Editable>
          </p>
          <p className="label mt-3 text-silverfaint">
            {usd(order.amountCents)} ·{" "}
            {order.invoiceUrl ? (
              <a
                href={order.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-chalk underline decoration-prize underline-offset-4 hover:text-prize"
              >
                VIEW INVOICE
              </a>
            ) : (
              "INVOICE ON ITS WAY BY EMAIL"
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/account#prizes" className={btnGo}>
              My prizes
            </Link>
            <button type="button" onClick={onClose} className={btn}>
              Keep shopping
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StoreFront() {
  const { ready, user, isAdmin } = useSupabaseAuth();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt>({ kind: "none" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void listProducts().then((res) => {
      if (!live) return;
      setProducts(res.products.filter((p) => p.active));
      setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [tick]);

  // Stripe's redirect back. Needs the session to be known, because
  // store-order-status only hands a claim code to the account that paid.
  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams(window.location.search);
    const flag = p.get("store");
    if (!flag) return;
    const sessionId = p.get("session_id");
    window.history.replaceState(null, "", window.location.pathname);

    window.setTimeout(() => {
      if (flag === "canceled") {
        setNotice("Checkout canceled - nothing was charged.");
        return;
      }
      if (!sessionId) return;
      setReceipt({ kind: "checking" });
      void confirmStoreOrder(sessionId).then((res) => {
        if (res.ok) {
          setReceipt({ kind: "paid", order: res.order });
          setTick((t) => t + 1);
          window.dispatchEvent(new Event(STORE_CHANGED));
        } else {
          setReceipt({ kind: "failed", error: res.error });
        }
      });
    }, 0);
  }, [ready]);

  const buy = async (p: Product, qty: number) => {
    setProblem(null);
    setBuying(p.id);
    const res = await startStoreCheckout(p.id, qty);
    if (!res.ok) {
      setProblem(res.error);
      setBuying(null);
      return;
    }
    window.location.assign(res.url);
  };

  const signedIn = ready && Boolean(user);

  return (
    <section aria-labelledby="store-title" id="store">
      {receipt.kind === "checking" && (
        <div className="mt-8 flex items-center justify-center gap-3 border border-line bg-ink px-6 py-10">
          <Spinner />
          <p className="label text-silverfaint">CONFIRMING YOUR PRIZE&hellip;</p>
        </div>
      )}
      {receipt.kind === "failed" && (
        <p className="label mt-8 border border-[rgba(200,16,46,0.5)] px-4 py-3 leading-loose text-bloodhi" role="alert">
          {receipt.error.toUpperCase()} - IF YOU WERE CHARGED, YOUR PRIZE IS STILL SAVED ON YOUR ACCOUNT.
        </p>
      )}
      {receipt.kind === "paid" && (
        <PrizeReceipt order={receipt.order} onClose={() => setReceipt({ kind: "none" })} />
      )}

      {notice && (
        <p className="label mt-8 border border-line px-4 py-3 text-silverdim">{notice.toUpperCase()}</p>
      )}
      {problem && (
        <p className="label mt-8 border border-[rgba(200,16,46,0.5)] px-4 py-3 leading-loose text-bloodhi" role="alert">
          {problem.toUpperCase()}
        </p>
      )}

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <h2 id="store-title" className="font-display text-[clamp(1.9rem,5vw,2.75rem)] leading-none">
          <Editable k="store.shelf.title">On the shelf</Editable>
        </h2>
        {products && products.length > 0 && (
          <p className="label text-silverfaint">
            {products.length} {products.length === 1 ? "PRIZE" : "PRIZES"}
          </p>
        )}
      </div>

      {products === null ? (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="aspect-[4/5] animate-pulse border border-line bg-ink" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="mt-6 border border-dashed border-linehi px-5 py-10 text-center">
          <p className="font-display text-[1.5rem]">
            <Editable k="store.empty.title">New prizes drop soon</Editable>
          </p>
          <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-silverdim">
            <Editable k="store.empty.blurb">
              The shelf restocks before every date. Until then, a straight donation below does the same good.
            </Editable>
          </p>
          {/* Only an admin can do anything about a store that didn't load. */}
          {error && isAdmin && <p className="label mt-3 text-bloodhi">{error.toUpperCase()}</p>}
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              p={p}
              signedIn={signedIn}
              busy={buying === p.id}
              onBuy={(qty) => void buy(p, qty)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
