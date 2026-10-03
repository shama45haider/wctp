"use client";

import { useCallback, useEffect, useState } from "react";
import TierEditor from "./TierEditor";
import { dayOf, monthOf, type Event } from "@/lib/events";
import { useRuntimeEvents } from "@/lib/events-runtime";
import {
  holderCounts,
  loadAddress,
  saveAddress,
  sendAddressNow,
} from "@/lib/event-address";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * Tickets and the address for any upcoming date - built into the site or
 * posted from the dashboard alike, which the posting form can't reach: a
 * built-in date has no row there to hit Edit on.
 *
 * Pick a date, set its prices (TierEditor, the same one the posting form
 * uses), and give it an address. The address is private to admins and goes
 * out by email to every ticket holder from noon the day before - or right
 * now, from here.
 */
export default function EventAddressAdmin() {
  const { upcoming } = useRuntimeEvents();
  const [picked, setPicked] = useState("");
  const chosen = upcoming.find((e) => e.slug === picked) ?? upcoming[0];

  if (!chosen) {
    return (
      <p className="px-5 py-5 text-[0.875rem] text-silverfaint">
        No upcoming dates. Post one and it shows up here.
      </p>
    );
  }

  return (
    <div className="grid gap-6 px-5 py-5">
      <label className="grid max-w-[28rem] gap-1.5">
        <span className="label text-silverfaint">DATE</span>
        <select
          value={chosen.slug}
          onChange={(e) => setPicked(e.target.value)}
          className={field}
        >
          {upcoming.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.dow} {dayOf(e.date)} {monthOf(e.date)} - {e.title}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <p className="label mb-3 tracking-[0.11em] text-silverdim uppercase">Prices</p>
          <TierEditor key={chosen.slug} slug={chosen.slug} redirectUrl={chosen.ticketRedirectUrl ?? ""} />
        </div>
        <div className="min-w-0">
          <p className="label mb-3 tracking-[0.11em] text-silverdim uppercase">Address</p>
          <AddressEditor key={chosen.slug} event={chosen} />
        </div>
      </div>
    </div>
  );
}

/** The day before a date, as "FRI 30 OCT". */
function dayBefore(iso: string) {
  const d = new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000);
  const dow = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  const prev = d.toISOString().slice(0, 10);
  return `${dow} ${dayOf(prev)} ${monthOf(prev)}`;
}

function AddressEditor({ event }: { event: Event }) {
  const [address, setAddress] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ holders: number; sent: number | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(async () => {
    const [detail, c] = await Promise.all([loadAddress(event.slug), holderCounts(event.slug)]);
    setAddress(detail.address);
    setSaved(detail.error ? null : detail.address);
    setProblem(detail.error);
    setCounts(c);
  }, [event.slug]);

  useEffect(() => {
    // Starts the read; the address arrives asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const dirty = saved !== null && address.trim() !== saved.trim();

  const save = async () => {
    setBusy("save");
    setProblem(null);
    setNotice(null);
    const out = await saveAddress(
      { slug: event.slug, title: event.title, date: event.date, doors: event.time },
      address,
    );
    setBusy(null);
    if (!out.ok) return setProblem(out.error ?? "That didn't save.");
    setSaved(address.trim());
    setNotice("Saved.");
  };

  const send = async () => {
    setConfirming(false);
    setBusy("send");
    setProblem(null);
    setNotice(null);
    const out = await sendAddressNow(event.slug);
    setBusy(null);
    if (!out.ok) return setProblem(out.error);
    setNotice(out.sent === 0 ? "Everyone with a ticket already has it." : `Sent to ${out.sent}.`);
    void refresh();
  };

  const waiting = counts && counts.sent !== null ? counts.holders - counts.sent : null;

  return (
    <div className="grid gap-3">
      <textarea
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        rows={3}
        placeholder={"123 Example St, Brooklyn, NY 11206\nRing the buzzer for 3F"}
        className={`${field} resize-y leading-relaxed`}
        aria-label={`Address for ${event.title}`}
      />

      <p className="text-[0.8125rem] leading-relaxed text-silverfaint">
        Only admins can see this. It&rsquo;s emailed to everyone with a ticket from{" "}
        <span className="text-silverdim">{dayBefore(event.date)}, 12:00 PM</span>, and to anyone who
        buys after that within the hour.
        {counts && (
          <>
            {" "}
            <span className="text-silverdim">
              {counts.holders} {counts.holders === 1 ? "order" : "orders"}
              {counts.sent !== null && ` · ${counts.sent} sent`}
            </span>
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy !== null || !dirty} className={btnGo}>
          {busy === "save" ? "Saving…" : "Save address"}
        </button>
        {confirming ? (
          <>
            <button type="button" onClick={send} className={btn}>
              Send to {waiting ?? "everyone"} now
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btn}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy !== null || !saved || dirty}
            className={btn}
          >
            {busy === "send" ? "Sending…" : "Email it now"}
          </button>
        )}
      </div>

      {problem && <p className="text-[0.8125rem] text-bloodhi">{problem}</p>}
      {notice && <p className="text-[0.8125rem] text-silver">{notice}</p>}
    </div>
  );
}
