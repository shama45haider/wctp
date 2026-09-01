"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Flyer from "./Flyer";
import { monthOf, dayOf, type Event } from "@/lib/events";
import {
  money,
  priceFrom,
  saleState,
  ticketsLeft,
  tiersFor,
} from "@/lib/tickets";

type FilterId = "all" | "free" | "paid" | "past";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "ON SALE" },
  { id: "free", label: "FREE" },
  { id: "paid", label: "PAID" },
  { id: "past", label: "PAST" },
];

const LOW_STOCK = 25;

/**
 * Availability, in the fewest words that still mean something at a glance.
 * Returns null when there is nothing urgent to say - an empty badge is noise.
 */
function stockNote(e: Event) {
  if (saleState(e) !== "on-sale") return null;
  const left = ticketsLeft(e.slug);
  return left <= LOW_STOCK ? `${left} LEFT` : null;
}

function Card({ e }: { e: Event }) {
  const state = saleState(e);
  const from = priceFrom(e);
  const tiers = tiersFor(e.slug);
  const note = stockNote(e);
  const closed = state !== "on-sale";

  return (
    <article className="group flex flex-col border border-line bg-ink transition-colors hover:border-linehi">
      <Link
        href={`/events/${e.slug}`}
        className="relative block aspect-[4/5] overflow-hidden sm:aspect-[3/4]"
      >
        {e.imageId ? (
          <Flyer
            id={e.imageId}
            alt={e.title}
            sizes="(max-width:639px) 92vw, (max-width:1023px) 46vw, 360px"
            maxWidth={640}
            className={`transition-[filter,transform] duration-500 group-hover:scale-[1.02] ${
              closed ? "grayscale" : ""
            }`}
          />
        ) : (
          <div className="hairline-x label flex h-full items-center justify-center bg-ink2 text-silverfaint">
            NO FLYER
          </div>
        )}

        <span className="absolute inset-0 bg-gradient-to-t from-[rgba(5,5,5,0.92)] via-[rgba(5,5,5,0.15)] to-transparent" />

        {/* Date block, stamped into the corner of the flyer. */}
        <span className="absolute top-0 left-0 border-r border-b border-linehi bg-void/85 px-3 py-2 text-center backdrop-blur-sm">
          <span className="label block text-silverfaint">
            {e.dow} {monthOf(e.date)}
          </span>
          <span className="font-display block text-[1.6rem] leading-none">
            {dayOf(e.date)}
          </span>
        </span>

        {state === "sold-out" && (
          <span className="label absolute top-3 right-3 border border-linehi bg-void/85 px-2 py-1 text-silver">
            SOLD OUT
          </span>
        )}
        {note && (
          <span className="label absolute top-3 right-3 border border-[rgba(200,16,46,0.6)] bg-void/85 px-2 py-1 text-bloodhi">
            {note}
          </span>
        )}

        <span className="absolute right-3 bottom-3 left-3">
          <span className="font-display block text-[1.45rem] leading-[1.05] break-words">
            {e.title}
          </span>
          <span className="label mt-1 block text-silverdim">
            {e.venue.toUpperCase()}
          </span>
        </span>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3.5">
        <div className="label">
          {closed ? (
            <span className="text-silverfaint">
              {state === "sold-out" ? "SOLD OUT" : "SALES CLOSED"}
            </span>
          ) : (
            <>
              {/* "From free" reads like a typo, so a zero floor just says free. */}
              {from !== null && from > 0 && tiers.length > 1 && (
                <span className="text-silverfaint">FROM </span>
              )}
              <span className="text-bloodhi">
                {from === 0 ? "FREE" : money(from ?? 0)}
              </span>
              <span className="text-silverfaint"> · {e.time}</span>
            </>
          )}
        </div>

        <Link
          href={`/events/${e.slug}${closed ? "" : "#tickets"}`}
          className={`label flex min-h-11 items-center border px-3.5 transition-all ${
            closed
              ? "border-line text-silverfaint hover:border-linehi hover:text-silver"
              : "border-[rgba(200,16,46,0.5)] text-chalk hover:border-bloodhi hover:bg-[rgba(200,16,46,0.08)]"
          }`}
        >
          {closed ? "DETAILS" : "GET TICKETS"} &rarr;
        </Link>
      </div>
    </article>
  );
}

export default function TicketsBrowser({
  upcoming,
  past,
}: {
  upcoming: Event[];
  past: Event[];
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");

  const events = useMemo(() => {
    const pool = filter === "past" ? past : upcoming;
    const q = query.trim().toLowerCase();

    return pool.filter((e) => {
      if (filter === "free" && (priceFrom(e) ?? 1) !== 0) return false;
      if (filter === "paid" && (priceFrom(e) ?? 0) === 0) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.venue.toLowerCase().includes(q) ||
        (e.city?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [filter, query, upcoming, past]);

  return (
    <>
      <div className="mb-8 flex flex-col gap-3 border-y border-line py-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Scrolls sideways rather than wrapping: four chips stay on one line
            at 320px, and the edge fade tells you there is more to the right. */}
        <div className="-mx-[4vw] overflow-x-auto px-[4vw] sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`label flex min-h-11 items-center border px-4 transition-colors ${
                  filter === f.id
                    ? "border-[rgba(200,16,46,0.6)] bg-[rgba(200,16,46,0.08)] text-bloodhi"
                    : "border-line text-silverdim hover:border-linehi hover:text-chalk"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex min-h-11 items-center gap-2 border border-line px-3 sm:w-[15rem]">
          <span className="label text-silverfaint" aria-hidden="true">
            /
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dates or venues"
            aria-label="Search events"
            className="label w-full bg-transparent py-2.5 text-chalk placeholder:text-silverfaint focus:outline-none"
          />
        </label>
      </div>

      {events.length === 0 ? (
        <div className="border border-dashed border-linehi p-10 text-center">
          <p className="font-display text-2xl">Nothing here</p>
          <p className="mt-2 text-sm text-silverdim">
            No dates match that. Try another word, or clear the filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Card key={e.slug} e={e} />
          ))}
        </div>
      )}

      <p className="label mt-8 text-silverfaint">
        SHOWING {String(events.length).padStart(2, "0")} OF{" "}
        {String(filter === "past" ? past.length : upcoming.length).padStart(2, "0")}
      </p>
    </>
  );
}
