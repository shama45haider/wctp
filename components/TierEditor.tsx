"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteTier, listTiersFor, saveTier } from "@/lib/ticket-catalog";
import { addonsOn, usd, type Tier } from "@/lib/tickets";
import { useTicketCatalog } from "@/lib/ticket-catalog";
import { btn, field } from "@/lib/ui";

/**
 * Setting up what an event sells, inside the event's own editor.
 *
 * Each tier is a row in public.ticket_tiers, which is what the event page
 * lists and what create-ticket-checkout charges from. A price of $0 is a free
 * RSVP; anything above it goes through Stripe. Sold counts are written only by
 * the payment functions, never from here.
 *
 * Deliberately no <form>: this sits inside the event form, and a nested form
 * is not allowed. Enter in a field is swallowed so it does not submit the
 * event instead.
 */

type Row = {
  tierId: string;
  name: string;
  price: string;
  capacity: string;
  maxPerOrder: string;
  sold: number;
  isNew: boolean;
};

const toRow = (t: Tier): Row => ({
  tierId: t.id,
  name: t.name,
  price: (t.priceCents / 100).toFixed(2),
  capacity: String(t.capacity),
  maxPerOrder: String(t.maxPerOrder),
  sold: t.sold,
  isNew: false,
});

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "ticket";

const noEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

const small = "label min-h-9 border px-3 tracking-[0.11em] uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function TierEditor({
  slug,
  redirectUrl,
}: {
  slug: string;
  /** The event's "sell somewhere else" link, as currently typed. */
  redirectUrl: string;
}) {
  useTicketCatalog();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const out = await listTiersFor(slug);
    setRows(out.tiers.filter((t) => !t.donation).map(toRow));
    setError(out.error ?? null);
  }, [slug]);

  useEffect(() => {
    // Starts the read; the rows arrive asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const set = (i: number, key: keyof Row, value: string) =>
    setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const add = () =>
    setRows((rs) => [
      ...(rs ?? []),
      {
        tierId: "",
        name: rs && rs.length ? "" : "General Admission",
        price: "",
        capacity: "100",
        // One ticket per account (create-ticket-checkout enforces it); the
        // field stays editable for anything that isn't a ticket.
        maxPerOrder: "1",
        sold: 0,
        isNew: true,
      },
    ]);

  const save = async (i: number) => {
    if (!rows) return;
    const r = rows[i];
    const name = r.name.trim();
    const price = Math.round(Number(r.price.replace(/[$,\s]/g, "") || "0") * 100);
    const capacity = Math.floor(Number(r.capacity));
    const maxPerOrder = Math.floor(Number(r.maxPerOrder));
    if (!name) return setError("Give the ticket a name.");
    if (!Number.isFinite(price) || price < 0) return setError("The price has to be a number.");
    if (price > 0 && price < 50) return setError("Stripe's minimum is $0.50.");
    if (!Number.isFinite(capacity) || capacity < 1) return setError("How many are there? At least 1.");
    if (!Number.isFinite(maxPerOrder) || maxPerOrder < 1) return setError("Max per order has to be at least 1.");

    let tierId = r.tierId;
    if (r.isNew) {
      const taken = new Set(rows.filter((x, j) => j !== i).map((x) => x.tierId));
      const base = slugify(name);
      tierId = base;
      for (let n = 2; taken.has(tierId); n++) tierId = `${base}-${n}`;
    }

    setBusy(`save-${i}`);
    setError(null);
    setNotice(null);
    const out = await saveTier(slug, { tierId, name, priceCents: price, capacity, maxPerOrder });
    setBusy(null);
    if (!out.ok) return setError(out.error ?? "That did not save.");
    setNotice(`Saved ${name}.`);
    void load();
  };

  const remove = async (i: number) => {
    if (!rows) return;
    const r = rows[i];
    if (r.isNew) {
      setRows(rows.filter((_, j) => j !== i));
      return;
    }
    if (!window.confirm(`Remove "${r.name}"? Tickets already sold stay valid.`)) return;
    setBusy(`del-${i}`);
    setError(null);
    setNotice(null);
    const out = await deleteTier(slug, r.tierId);
    setBusy(null);
    if (!out.ok) return setError(out.error ?? "That did not delete.");
    setNotice(`Removed ${r.name}.`);
    void load();
  };

  const addons = addonsOn();
  const selling = rows && rows.some((r) => !r.isNew);

  return (
    <div className="flex flex-col gap-3">
      <p className="label text-silverfaint uppercase">Sell on the site</p>

      {redirectUrl.trim() && selling && (
        <p className="border border-[rgba(200,16,46,0.45)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-bloodhi">
          The link above is set, so buyers are sent there instead of these
          tickets. Clear it and save the event to sell here.
        </p>
      )}

      {rows === null ? (
        <p className="label text-silverfaint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[0.8125rem] leading-relaxed text-silverfaint">
          No tickets yet. Add one - a price of $0 makes it a free RSVP, anything
          else is paid through Stripe.
        </p>
      ) : (
        rows.map((r, i) => (
          <div key={r.isNew ? `new-${i}` : r.tierId} className="border border-line p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]">
              <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                <span className="label text-silverfaint uppercase">Name</span>
                <input
                  value={r.name}
                  onChange={(e) => set(i, "name", e.target.value)}
                  onKeyDown={noEnter}
                  placeholder="General Admission"
                  className={`${field} w-full min-w-0`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-silverfaint uppercase">Price $</span>
                <input
                  value={r.price}
                  onChange={(e) => set(i, "price", e.target.value)}
                  onKeyDown={noEnter}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${field} w-full min-w-0`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-silverfaint uppercase">How many</span>
                <input
                  value={r.capacity}
                  onChange={(e) => set(i, "capacity", e.target.value)}
                  onKeyDown={noEnter}
                  inputMode="numeric"
                  className={`${field} w-full min-w-0`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label text-silverfaint uppercase">Max / order</span>
                <input
                  value={r.maxPerOrder}
                  onChange={(e) => set(i, "maxPerOrder", e.target.value)}
                  onKeyDown={noEnter}
                  inputMode="numeric"
                  className={`${field} w-full min-w-0`}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save(i)}
                disabled={busy !== null}
                className={`${small} border-linehi text-chalk hover:border-silverdim`}
              >
                {busy === `save-${i}` ? "Saving…" : r.isNew ? "Add" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void remove(i)}
                disabled={busy !== null}
                className={`${small} border-[rgba(200,16,46,0.45)] text-bloodhi hover:border-bloodhi`}
              >
                {busy === `del-${i}` ? "Removing…" : r.isNew ? "Discard" : "Remove"}
              </button>
              {!r.isNew && (
                <span className="label ml-auto text-silverfaint">
                  {r.sold} SOLD
                  {Number(r.price) > 0 ? " · STRIPE" : " · FREE RSVP"}
                </span>
              )}
            </div>
          </div>
        ))
      )}

      <button type="button" onClick={add} disabled={busy !== null} className={btn}>
        + Add a ticket type
      </button>

      {addons.length > 0 && (
        <p className="text-[0.8125rem] leading-relaxed text-silverfaint">
          Add-ons offered with every ticket:{" "}
          {addons.map((a) => `${a.name} ${usd(a.priceCents)}`).join(" · ")}. The
          door sees them when it scans the ticket.
        </p>
      )}

      {error && (
        <p
          className="border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] px-3 py-2.5 text-[0.875rem] leading-relaxed text-bloodhi"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-[0.8125rem] text-silverdim" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
