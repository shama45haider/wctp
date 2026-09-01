"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { flyer, monthOf, dayOf, type Event } from "@/lib/events";
import RsvpModal from "./RsvpModal";

function Row({ e, onRsvp }: { e: Event; onRsvp: () => void }) {
  const src = flyer(e.imageId);
  return (
    <article className="group relative grid grid-cols-[4.5rem_1fr] items-center gap-x-5 gap-y-4 border-b border-line px-4 py-6 transition-colors hover:bg-white/[0.022] md:grid-cols-[5rem_6rem_minmax(0,1fr)_13rem_7rem_auto] md:gap-6">
      <span className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-blood transition-transform group-hover:scale-y-100" />

      <div>
        <span className="label block text-silverfaint">
          {e.dow} {monthOf(e.date)}
        </span>
        <span className="font-display text-[2.1rem] leading-none">
          {dayOf(e.date)}
        </span>
      </div>

      <div className="relative hidden aspect-square overflow-hidden border border-line md:block">
        {src ? (
          <Image src={src} alt="" fill sizes="96px" className="object-cover" />
        ) : (
          <div className="h-full w-full bg-ink2" />
        )}
      </div>

      <div className="col-start-2 md:col-start-auto">
        <h3 className="font-display text-[1.75rem]">
          <Link href={`/events/${e.slug}`} className="hover:text-bloodhi">
            {e.title}
          </Link>
        </h3>
        <div className="label mt-0.5 text-silverfaint">WECAMETOOPARTY</div>
        {typeof e.going === "number" && (
          <span className="label mt-2 inline-block border border-[rgba(200,16,46,0.55)] px-2.5 py-1 text-bloodhi">
            {e.going} GOING
          </span>
        )}
      </div>

      <div className="label col-start-2 text-silverdim md:col-start-auto">
        {e.venue.toUpperCase()}
        {e.city && (
          <>
            <br />
            {e.city}
          </>
        )}
      </div>

      <div className="label col-start-2 text-chalk md:col-start-auto">
        {e.time}
        {e.endTime && (
          <>
            <br />
            <span className="text-silverfaint">TIL {e.endTime}</span>
          </>
        )}
      </div>

      <button
        onClick={onRsvp}
        className="font-display col-start-2 justify-self-start border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] px-[1.15rem] py-[0.6rem] tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)] md:col-start-auto"
      >
        RSVP
      </button>
    </article>
  );
}

export default function EventManifest({ events }: { events: Event[] }) {
  const [active, setActive] = useState<Event | null>(null);
  return (
    <>
      <div className="border-t border-line">
        {events.map((e) => (
          <Row key={e.slug} e={e} onRsvp={() => setActive(e)} />
        ))}
      </div>
      {active && <RsvpModal event={active} onClose={() => setActive(null)} />}
    </>
  );
}
