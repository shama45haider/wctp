"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/demo-account";
import { useRuntimeEvents } from "@/lib/events-runtime";
import { useTicketCatalog } from "@/lib/ticket-catalog";
import { admissionTiers, isSoldOut, saleState, usd, type Tier } from "@/lib/tickets";
import { btn, btnGo } from "@/lib/ui";

/**
 * The buy link: /buy/?e=<slug>, optionally &t=<tier id>.
 *
 * Shown to copy in /admin/events once a date has tickets, for posting
 * anywhere. It puts one ticket in the cart and hands over to /checkout, which
 * is where the rules live - signed in, verified, one ticket per account - and
 * which is the only way to Stripe. Nothing here can sell to an account that
 * checkout would refuse.
 *
 * With one ticket type on sale (or `t` naming one) it goes straight through.
 * With several, the buyer picks.
 */

const noop = () => () => {};
const readQuery = () => window.location.search;
const noQuery = () => null;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-[92vw] max-w-[560px] py-[clamp(3rem,10vw,6rem)]">{children}</main>
  );
}

export default function BuyPage() {
  const router = useRouter();
  const query = useSyncExternalStore(noop, readQuery, noQuery);
  const params = useMemo(() => new URLSearchParams(query ?? ""), [query]);
  const slug = (params.get("e") ?? "").trim();
  const wantedTier = (params.get("t") ?? "").trim();

  const runtime = useRuntimeEvents();
  const catalog = useTicketCatalog();
  const { clearCart, setQty } = useAccount();
  const went = useRef(false);

  const loaded = query !== null && runtime.ready && catalog.loaded;
  const event = loaded ? runtime.events.find((e) => e.slug === slug) : undefined;
  const state = event ? saleState(event, runtime.now) : null;
  const open: Tier[] = event ? admissionTiers(event.slug).filter((t) => !isSoldOut(t)) : [];
  const pick = open.find((t) => t.id === wantedTier) ?? (open.length === 1 ? open[0] : undefined);

  const take = (t: Tier) => {
    if (!event || went.current) return;
    went.current = true;
    // One ticket per account, so the cart is this ticket and nothing else.
    clearCart();
    setQty(event.slug, t.id, 1);
    router.replace("/checkout/");
  };

  useEffect(() => {
    if (!event || went.current) return;
    if (event.ticketRedirectUrl) {
      went.current = true;
      window.location.replace(event.ticketRedirectUrl);
      return;
    }
    if (state === "on-sale" && pick) take(pick);
    // take() reads only what is in these deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, state, pick]);

  if (!loaded || (event && (event.ticketRedirectUrl || (state === "on-sale" && pick)))) {
    return (
      <Shell>
        <p className="label text-silverfaint uppercase">Getting your ticket&hellip;</p>
      </Shell>
    );
  }

  if (!event || state !== "on-sale" || open.length === 0) {
    return (
      <Shell>
        <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          {!event ? "Date not found" : state === "sold-out" ? "Sold out" : "Sales closed"}
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          {!event
            ? "That link doesn't match a date on the site."
            : `Tickets for ${event.title} aren't on sale right now.`}
        </p>
        <Link href="/tickets" className={`${btnGo} mt-7 w-full`}>
          See every date
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="label text-silverfaint uppercase">Pick your ticket</p>
      <h1 className="font-display chrome mt-3 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85] break-words">
        {event.title}
      </h1>
      <div className="mt-7 flex flex-col gap-3">
        {open.map((t) => (
          <button key={t.id} type="button" onClick={() => take(t)} className={`${btn} w-full justify-between`}>
            <span>{t.name}</span>
            <span>{t.priceCents > 0 ? usd(t.priceCents) : "Free"}</span>
          </button>
        ))}
      </div>
      <p className="mt-5 text-[0.8125rem] leading-relaxed text-silverfaint">
        One ticket per account. You&apos;ll need to sign in with a verified account to pay.
      </p>
    </Shell>
  );
}
