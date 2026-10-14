"use client";

import { useEffect, useState } from "react";
import { listAllAddons, saveAddon, type AddonDraft } from "@/lib/ticket-catalog";
import { siteImageUrl, uploadSiteImage } from "@/lib/site-content";
import { btn, btnGo, field } from "@/lib/ui";
import { usd } from "@/lib/tickets";

/**
 * The add-ons sold with any ticket: name, price, a picture, and whether they
 * show in the picker. Add-ons are not tied to one night, so this editor sits
 * on its own rather than inside an event.
 */

type Row = AddonDraft & { sort: number };

const EMPTY: AddonDraft = {
  id: "",
  name: "",
  priceCents: 0,
  maxPerOrder: 10,
  imagePath: null,
  active: true,
};

/** A short id from the name, in the shape the database allows. */
function idFrom(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function AddonEditor() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddonDraft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const out = await listAllAddons();
    if (out.error) setError(out.error);
    else {
      setError(null);
      setRows(out.addons);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const open = (r: AddonDraft) => {
    setDraft(r);
    setDollars((r.priceCents / 100).toFixed(2));
    setEditing(true);
    setNotice(null);
  };

  const reset = () => {
    setDraft(EMPTY);
    setDollars("");
    setEditing(false);
    setNotice(null);
  };

  const onPicture = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNotice("Uploading picture...");
    const out = await uploadSiteImage(file, "addons");
    setBusy(false);
    if (out.error || !out.path) {
      setNotice(out.error ?? "The picture did not upload.");
      return;
    }
    setDraft((d) => ({ ...d, imagePath: out.path ?? null }));
    setNotice("Picture uploaded. Save to keep it.");
  };

  const save = async () => {
    const name = draft.name.trim();
    const price = Math.round(Number(dollars) * 100);
    if (!name) return setNotice("Give it a name.");
    if (!Number.isFinite(price) || price <= 0) return setNotice("Set a price above $0.");
    if (draft.maxPerOrder < 1) return setNotice("Max per order must be at least 1.");

    const id = editing ? draft.id : idFrom(name);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
      return setNotice("That name cannot make a short id. Use letters or numbers.");
    }
    const sort = editing
      ? (rows?.find((r) => r.id === id)?.sort ?? 0)
      : (rows?.reduce((m, r) => Math.max(m, r.sort), 0) ?? 0) + 1;

    setBusy(true);
    const out = await saveAddon({ ...draft, id, name, priceCents: price }, sort);
    setBusy(false);
    if (!out.ok) return setNotice(out.error ?? "Nothing saved.");
    setNotice("Saved.");
    reset();
    void load();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <p className="label flex items-center gap-2 tracking-[0.11em] text-blood uppercase">
          <span className="h-2 w-2 rounded-full bg-blood" aria-hidden />
          Add-ons
        </p>
        <button type="button" onClick={reset} className={btn}>
          New add-on
        </button>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* The list, with each add-on's picture as its thumbnail. */}
        <div>
          {error && <p className="text-[0.9375rem] text-bloodhi">{error}</p>}
          {rows === null && !error && <p className="label text-silverfaint">Loading...</p>}
          {rows && rows.length === 0 && (
            <p className="text-[0.9375rem] text-silverdim">No add-ons yet. Make the first one.</p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows?.map((r) => {
              const pic = siteImageUrl(r.imagePath);
              return (
                <li key={r.id} className="flex items-center gap-4 border border-line bg-void p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden bg-ink2">
                    {pic && <img src={pic} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display truncate text-[1.1rem]">{r.name}</p>
                    <p className="label mt-1 text-silverdim">
                      {usd(r.priceCents)} · max {r.maxPerOrder}
                      {!r.active && " · hidden"}
                    </p>
                  </div>
                  <button type="button" onClick={() => open(r)} className={btn}>
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The form: the same fields whether making one or editing one. */}
        <div className="flex flex-col gap-3 border border-line bg-void p-4">
          <p className="label text-blood">{editing ? `Editing ${draft.name}` : "New add-on"}</p>

          <label className="flex flex-col gap-1.5">
            <span className="label text-silverdim">Name</span>
            <input
              className={field}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Vampire Punch"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="label text-silverdim">Price (USD)</span>
              <input
                className={field}
                inputMode="decimal"
                value={dollars}
                onChange={(e) => setDollars(e.target.value)}
                placeholder="10.00"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label text-silverdim">Max per order</span>
              <input
                className={field}
                type="number"
                min={1}
                value={draft.maxPerOrder}
                onChange={(e) => setDraft({ ...draft, maxPerOrder: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="label text-silverdim">Picture</span>
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(e) => void onPicture(e.target.files?.[0])}
              className="text-[0.9375rem] text-silver file:mr-3 file:border file:border-line-hi file:bg-ink file:px-3 file:py-2 file:text-silver"
            />
          </label>
          {siteImageUrl(draft.imagePath) && (
            <img
              src={siteImageUrl(draft.imagePath) ?? ""}
              alt=""
              className="aspect-square w-full max-w-[12rem] object-cover"
            />
          )}

          <label className="flex items-center gap-3 text-[0.9375rem] text-silver">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              className="h-5 w-5 accent-[var(--blood)]"
            />
            Show in the ticket picker
          </label>

          {notice && <p className="text-[0.9375rem] text-silverdim">{notice}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={() => void save()} disabled={busy} className={btnGo}>
              {editing ? "Save changes" : "Add add-on"}
            </button>
            {editing && (
              <button type="button" onClick={reset} className={btn}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
