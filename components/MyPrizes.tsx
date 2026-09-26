"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import { listStoreOrders, NEEDS_0025, STORE_CHANGED, type StoreOrder } from "@/lib/store";
import { usd } from "@/lib/tickets";
import { Editable } from "./Editable";
import PrizeQr from "./PrizeQr";

/**
 * The account's prizes from the store, each with the QR staff scan to hand
 * it over. Draws nothing at all for someone who has never bought one - an
 * empty "prizes" heading on every account would just be an ad.
 */
export default function MyPrizes() {
  const { user } = useSupabaseAuth();
  const userId = user?.id;
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(STORE_CHANGED, bump);
    return () => window.removeEventListener(STORE_CHANGED, bump);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void listStoreOrders(userId).then((res) => {
      if (!live) return;
      setOrders(res.orders);
      // A database without the store yet is not the buyer's problem.
      setError(res.error === NEEDS_0025 ? null : res.error);
    });
    return () => {
      live = false;
    };
  }, [userId, tick]);

  if (!userId || (orders.length === 0 && !error)) return null;

  const waiting = orders.filter((o) => !o.redeemedAt);
  const collected = orders.filter((o) => o.redeemedAt);

  return (
    <section id="prizes" className="mt-14 scroll-mt-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-[2rem]">
          <Editable k="account.prizes.title">Prizes</Editable>
          <span className="label ml-3 align-middle text-prize">
            {waiting.length} <Editable k="account.prizes.waiting">TO PICK UP</Editable>
          </span>
        </h2>
        <Link href="/donate#store" className="label text-silverdim hover:text-chalk">
          THE STORE &rarr;
        </Link>
      </div>

      {error && (
        <p className="label mb-6 border border-[rgba(200,16,46,0.5)] px-4 py-3 leading-loose text-bloodhi" role="alert">
          {error.toUpperCase()}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...waiting, ...collected].map((o) => (
          <article
            key={o.id}
            className={`flex flex-col border bg-ink ${
              o.redeemedAt ? "border-line opacity-60" : "border-[rgba(255,209,102,0.4)]"
            }`}
          >
            <div className="label flex items-center justify-between border-b border-line px-4 py-2.5 text-silverfaint">
              <span>
                {new Date(o.paidAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
              <span className="text-prize">{usd(o.amountCents)}</span>
            </div>
            <div className="px-4 pt-4 pb-3">
              <h3 className="font-display text-[1.35rem] break-words">
                {o.qty > 1 ? `${o.qty} × ` : ""}
                {o.productName}
              </h3>
              <p className="label mt-1 text-silverfaint">
                {o.redeemedAt ? (
                  <>
                    <Editable k="account.prizes.collected">COLLECTED</Editable>{" "}
                    {new Date(o.redeemedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </>
                ) : (
                  <Editable k="account.prizes.show">SHOW THIS AT THE NEXT EVENT</Editable>
                )}
              </p>
            </div>
            {!o.redeemedAt && (
              <div className="flex justify-center border-t border-dashed border-line px-4 py-5">
                <PrizeQr code={o.claimCode} size={156} />
              </div>
            )}
            {o.invoiceUrl && (
              <a
                href={o.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="label mt-auto border-t border-line px-4 py-3 text-silverdim transition-colors hover:text-chalk"
              >
                INVOICE {o.invoiceNumber ?? ""} &rarr;
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
