"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { btn, btnGo, field, num, tableEl, tableWrap, td, th } from "@/lib/ui";
import { atHandle } from "@/lib/handle";
import { siteImageUrl, uploadSiteImage } from "@/lib/site-content";
import {
  deleteProduct,
  leftOf,
  listProducts,
  listStoreOrders,
  redeemOrder,
  saveProduct,
  unredeemOrder,
  type Product,
  type ProductDraft,
  type StoreOrder,
} from "@/lib/store";
import { usd } from "@/lib/tickets";

/**
 * The dashboard's store tab: what's on the shelf, who bought what, and the
 * handover.
 *
 * Products are written straight to store_products (admins only, by RLS).
 * Sales are never written from here - only Stripe, through the edge
 * functions, creates one - so this only reads them, marks them handed over,
 * and undoes a handover tapped by mistake. The sales list re-reads itself
 * every 20 seconds while the tab is open, so a purchase made on someone's
 * phone shows up here without a refresh.
 *
 * The panel primitives copy app/admin/page.tsx class for class; a page file
 * may only export its page, so they cannot be imported from there.
 */

const POLL_MS = 20_000;

/* ------------------------------------------------------------ primitives -- */

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`border border-line bg-ink ${className}`}>{children}</section>;
}

function PanelHead({
  title,
  sub,
  count,
  right,
}: {
  title: string;
  sub?: string;
  count?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <p className="label flex items-center gap-2 tracking-[0.11em] text-silverdim uppercase">
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-ink2 px-2 py-0.5 text-silver tabular-nums">{count}</span>
          )}
        </p>
        {sub && <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-silverfaint">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

function PanelBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-5 ${className}`}>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-line px-4 py-6 text-center">
      <p className="mx-auto max-w-[46ch] text-[0.9375rem] leading-relaxed text-silverdim">{children}</p>
    </div>
  );
}

function Refused({ message }: { message: string }) {
  return (
    <p
      className="border border-[rgba(200,16,46,0.45)] bg-[rgba(200,16,46,0.06)] px-3 py-2.5 text-[0.9375rem] leading-relaxed text-bloodhi"
      role="alert"
    >
      {message}
    </p>
  );
}

function Kpi({ label, value, sub, gold = false }: { label: string; value: string; sub?: string; gold?: boolean }) {
  return (
    <div className="flex flex-col bg-ink px-5 py-4">
      <p className="label tracking-[0.11em] text-silverfaint uppercase">{label}</p>
      <p
        className={`font-display mt-2.5 text-[clamp(1.75rem,5.5vw,2.375rem)] leading-none tabular-nums ${
          gold ? "text-prize" : "text-chalk"
        }`}
      >
        {value}
      </p>
      {sub && <p className="label mt-auto pt-2.5 leading-relaxed text-silverfaint uppercase">{sub}</p>}
    </div>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/* --------------------------------------------------------------- editor -- */

type Draft = {
  name: string;
  blurb: string;
  price: string;
  stock: string;
  active: boolean;
  sort: string;
  imagePath: string | null;
};

const blank: Draft = { name: "", blurb: "", price: "", stock: "", active: true, sort: "0", imagePath: null };

function toDraft(p: Product): Draft {
  return {
    name: p.name,
    blurb: p.blurb,
    price: (p.priceCents / 100).toFixed(2),
    stock: p.stock === null ? "" : String(p.stock),
    active: p.active,
    sort: String(p.sort),
    imagePath: p.imagePath,
  };
}

function ProductEditor({
  product,
  onDone,
  onClose,
}: {
  product: Product | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [draft, setDraft] = useState<Draft>(product ? toDraft(product) : blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  const shown = preview ?? siteImageUrl(draft.imagePath);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const priceCents = Math.round(Number(draft.price.replace(/[$,\s]/g, "")) * 100);
    if (!draft.name.trim()) return setProblem("Give it a name.");
    if (!Number.isFinite(priceCents) || priceCents < 100 || priceCents > 100000) {
      return setProblem("Price has to be between $1 and $1,000.");
    }
    const stock = draft.stock.trim() === "" ? null : Number(draft.stock);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      return setProblem("Stock is a whole number, or empty for no limit.");
    }

    setBusy(true);
    let imagePath = draft.imagePath;
    if (file) {
      const up = await uploadSiteImage(file, "store");
      if (up.error || !up.path) {
        setBusy(false);
        return setProblem(up.error ?? "The photo did not upload.");
      }
      imagePath = up.path;
    }

    const payload: ProductDraft = {
      name: draft.name,
      blurb: draft.blurb,
      priceCents,
      imagePath,
      stock,
      active: draft.active,
      sort: Number(draft.sort) || 0,
    };
    const res = await saveProduct(product?.id ?? null, payload);
    setBusy(false);
    if (!res.ok) return setProblem(res.error);
    onDone();
  };

  const remove = async () => {
    if (!product) return;
    setBusy(true);
    const res = await deleteProduct(product.id);
    setBusy(false);
    if (!res.ok) return setProblem(res.error ?? "Could not delete it.");
    onDone();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5 border border-linehi bg-ink2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <span className="label text-prize">{product ? "EDITING PRODUCT" : "NEW PRODUCT BOX"}</span>
        <button type="button" onClick={onClose} className="label min-h-11 text-silverfaint hover:text-chalk">
          CLOSE
        </button>
      </div>

      <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <p className="label text-silverfaint">PHOTO</p>
          <label
            htmlFor={id("photo")}
            className="relative mt-2 flex aspect-square cursor-pointer items-center justify-center overflow-hidden border border-dashed border-linehi bg-ink text-center transition-colors hover:border-silverdim"
          >
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="label px-3 text-silverfaint">TAP TO ADD A PHOTO</span>
            )}
          </label>
          <input
            id={id("photo")}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {(shown || draft.imagePath) && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                set("imagePath", null);
              }}
              className="label mt-2 min-h-9 text-silverfaint hover:text-bloodhi"
            >
              REMOVE PHOTO
            </button>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor={id("name")} className="label text-silverfaint">NAME</label>
            <input
              id={id("name")}
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={80}
              placeholder="Glow bracelet, sticker pack…"
              className={`${field} mt-2 w-full`}
            />
          </div>
          <div>
            <label htmlFor={id("blurb")} className="label text-silverfaint">DESCRIPTION</label>
            <textarea
              id={id("blurb")}
              value={draft.blurb}
              onChange={(e) => set("blurb", e.target.value)}
              rows={3}
              maxLength={500}
              className={`${field} mt-2 w-full resize-y`}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor={id("price")} className="label text-silverfaint">PRICE $</label>
              <input
                id={id("price")}
                value={draft.price}
                onChange={(e) => set("price", e.target.value)}
                inputMode="decimal"
                placeholder="10.00"
                className={`${field} mt-2 w-full`}
              />
            </div>
            <div>
              <label htmlFor={id("stock")} className="label text-silverfaint">STOCK</label>
              <input
                id={id("stock")}
                value={draft.stock}
                onChange={(e) => set("stock", e.target.value)}
                inputMode="numeric"
                placeholder="No limit"
                className={`${field} mt-2 w-full`}
              />
            </div>
            <div>
              <label htmlFor={id("sort")} className="label text-silverfaint">ORDER</label>
              <input
                id={id("sort")}
                value={draft.sort}
                onChange={(e) => set("sort", e.target.value)}
                inputMode="numeric"
                className={`${field} mt-2 w-full`}
              />
            </div>
          </div>
          <label className="label flex min-h-11 items-center gap-3 text-silverdim">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => set("active", e.target.checked)}
              className="h-4 w-4 accent-blood"
            />
            ON SALE - SHOWN ON THE STORE
          </label>
        </div>
      </div>

      {problem && <Refused message={problem} />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {product ? (
          confirmDelete ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="label min-h-11 border border-[rgba(200,16,46,0.5)] px-3 text-bloodhi hover:border-bloodhi"
              >
                YES, DELETE IT
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="label min-h-11 px-2 text-silverfaint">
                KEEP
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="label min-h-11 text-silverfaint transition-colors hover:text-bloodhi"
            >
              DELETE PRODUCT
            </button>
          )
        ) : (
          <span />
        )}
        <button type="submit" disabled={busy} className={btnGo}>
          {busy ? "Saving…" : product ? "Save changes" : "Put it on the shelf"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ tab -- */

export default function StoreAdmin() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [filter, setFilter] = useState<"waiting" | "all">("waiting");
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [codeMsg, setCodeMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reloadProducts = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    void listProducts().then((res) => {
      if (!live) return;
      setProducts(res.products);
      setProductsError(res.error);
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const [orderTick, setOrderTick] = useState(0);
  useEffect(() => {
    let live = true;
    void listStoreOrders().then((res) => {
      if (!live) return;
      setOrders(res.orders);
      setOrdersError(res.error);
    });
    const timer = window.setInterval(() => setOrderTick((t) => t + 1), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [orderTick]);
  const reloadOrders = () => setOrderTick((t) => t + 1);

  const stats = useMemo(() => {
    const rows = orders ?? [];
    return {
      revenue: rows.reduce((s, o) => s + o.amountCents, 0),
      items: rows.reduce((s, o) => s + o.qty, 0),
      waiting: rows.filter((o) => !o.redeemedAt).length,
      handed: rows.filter((o) => o.redeemedAt).length,
    };
  }, [orders]);

  const shownOrders = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^@/, "");
    return (orders ?? []).filter((o) => {
      if (filter === "waiting" && o.redeemedAt) return false;
      if (!q) return true;
      return [o.buyerName, o.buyerEmail, o.buyerHandle ?? "", o.buyerPhone ?? "", o.productName, o.claimCode]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [orders, filter, search]);

  const handOver = async (claim: string, id?: string) => {
    if (id) setBusyId(id);
    const res = await redeemOrder(claim);
    setBusyId(null);
    if (!res.ok) {
      setCodeMsg({ tone: "bad", text: res.error });
      return false;
    }
    setCodeMsg(
      res.justRedeemed
        ? { tone: "ok", text: `Handed over - ${claim}.` }
        : { tone: "bad", text: `Already handed over ${res.redeemedAt ? when(res.redeemedAt) : ""}.` },
    );
    reloadOrders();
    return true;
  };

  const undo = async (id: string) => {
    setBusyId(id);
    const res = await unredeemOrder(id);
    setBusyId(null);
    if (!res.ok) setCodeMsg({ tone: "bad", text: res.error ?? "Could not undo that." });
    reloadOrders();
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/^.*#/, "");
    if (!c) return;
    const ok = await handOver(c.startsWith("PRZ-") ? c : `PRZ-${c}`);
    if (ok) setCode("");
  };

  const editingProduct = editing && editing !== "new" ? products?.find((p) => p.id === editing) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------- totals -- */}
      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        <Kpi label="Waiting for pickup" value={orders ? String(stats.waiting) : "··"} sub="Paid, not handed over" gold />
        <Kpi label="Handed over" value={orders ? String(stats.handed) : "··"} />
        <Kpi label="Items sold" value={orders ? String(stats.items) : "··"} />
        <Kpi label="Store revenue" value={orders ? usd(stats.revenue) : "··"} sub="What Stripe charged" />
      </div>

      {/* ------------------------------------------------- hand over by code -- */}
      <Panel>
        <PanelHead
          title="Hand over a prize"
          sub="Scan the buyer's QR with the phone camera - it opens the order to hand over. Or type the code under it here."
        />
        <PanelBody>
          <form onSubmit={submitCode} className="flex flex-wrap gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="PRZ-XXXXXXXXXXXXXXXX"
              autoCapitalize="characters"
              className={`${field} label min-w-0 flex-1 tracking-[0.12em] uppercase`}
            />
            <button type="submit" className={btnGo}>
              Hand over
            </button>
          </form>
          {codeMsg && (
            <p
              className={`label mt-3 leading-loose ${codeMsg.tone === "ok" ? "text-prize" : "text-bloodhi"}`}
              role="status"
            >
              {codeMsg.text.toUpperCase()}
            </p>
          )}
        </PanelBody>
      </Panel>

      {/* ----------------------------------------------------------- sales -- */}
      <Panel>
        <PanelHead
          title="Who bought what"
          count={orders ? shownOrders.length : undefined}
          sub="Refreshes by itself every 20 seconds."
          right={
            <>
              <div className="flex border border-line">
                {(["waiting", "all"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={`label min-h-9 px-3 uppercase transition-colors ${
                      filter === f ? "bg-ink2 text-chalk" : "text-silverfaint hover:text-chalk"
                    }`}
                  >
                    {f === "waiting" ? "To pick up" : "All"}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search sales"
                className={`${field} min-h-9 w-36 py-1.5 text-[0.875rem]`}
              />
            </>
          }
        />
        {ordersError ? (
          <PanelBody>
            <Refused message={ordersError} />
          </PanelBody>
        ) : orders === null ? (
          <PanelBody>
            <p className="label animate-pulse text-silverfaint">LOADING SALES…</p>
          </PanelBody>
        ) : shownOrders.length === 0 ? (
          <PanelBody>
            <Empty>
              {orders.length === 0
                ? "No prizes sold yet. They show up here the moment Stripe confirms a payment."
                : filter === "waiting"
                  ? "Everything sold has been handed over."
                  : "Nothing matches that search."}
            </Empty>
          </PanelBody>
        ) : (
          <div className={tableWrap}>
            <table className={tableEl}>
              <thead>
                <tr>
                  <th className={th}>Buyer</th>
                  <th className={th}>Contact</th>
                  <th className={th}>Prize</th>
                  <th className={`${th} ${num}`}>Paid</th>
                  <th className={th}>When</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {shownOrders.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-ink2/50">
                    <td className={td}>
                      <p className="text-[0.9375rem] text-chalk">{o.buyerName || "—"}</p>
                      {o.buyerHandle && <p className="label mt-0.5 text-silverfaint">{atHandle(o.buyerHandle)}</p>}
                    </td>
                    <td className={td}>
                      <p className="label break-all text-silver">{o.buyerEmail || "—"}</p>
                      {o.buyerPhone && <p className="label mt-0.5 text-silverfaint">{o.buyerPhone}</p>}
                    </td>
                    <td className={td}>
                      <p className="text-[0.9375rem] text-chalk">
                        {o.qty > 1 ? `${o.qty} × ` : ""}
                        {o.productName}
                      </p>
                      <p className="label mt-0.5 text-silverfaint">{o.claimCode}</p>
                    </td>
                    <td className={`${td} ${num}`}>
                      <p className="text-chalk">{usd(o.amountCents)}</p>
                      {o.invoiceUrl && (
                        <a
                          href={o.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="label mt-0.5 inline-block text-silverfaint underline decoration-prize underline-offset-4 hover:text-chalk"
                        >
                          {o.invoiceNumber ?? "INVOICE"}
                        </a>
                      )}
                    </td>
                    <td className={`${td} label whitespace-nowrap text-silverfaint`}>{when(o.paidAt)}</td>
                    <td className={td}>
                      {o.redeemedAt ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="label whitespace-nowrap text-silverdim">HANDED {when(o.redeemedAt)}</span>
                          <button
                            type="button"
                            onClick={() => void undo(o.id)}
                            disabled={busyId === o.id}
                            className="label min-h-9 text-silverfaint underline underline-offset-4 hover:text-bloodhi"
                          >
                            UNDO
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handOver(o.claimCode, o.id)}
                          disabled={busyId === o.id}
                          className="label min-h-9 border border-[rgba(255,209,102,0.45)] px-3 whitespace-nowrap text-prize transition-colors hover:bg-[rgba(255,209,102,0.08)]"
                        >
                          {busyId === o.id ? "…" : "HAND OVER"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* -------------------------------------------------------- products -- */}
      <Panel>
        <PanelHead
          title="Product boxes"
          count={products?.length}
          sub="What's on the store. Buyers pay by card through Stripe, get an invoice by email, and a QR to pick up at the next event."
          right={
            editing === null ? (
              <button type="button" onClick={() => setEditing("new")} className={btn}>
                + New product
              </button>
            ) : undefined
          }
        />
        <PanelBody className="flex flex-col gap-4">
          {productsError && <Refused message={productsError} />}

          {editing === "new" && (
            <ProductEditor
              product={null}
              onClose={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                reloadProducts();
              }}
            />
          )}

          {products === null ? (
            <p className="label animate-pulse text-silverfaint">LOADING PRODUCTS…</p>
          ) : products.length === 0 && editing !== "new" ? (
            <Empty>Nothing on the shelf yet. Add a product box and it appears on the store right away.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((p) =>
                editing === p.id && editingProduct ? (
                  <li key={p.id} className="sm:col-span-2 xl:col-span-3">
                    <ProductEditor
                      product={editingProduct}
                      onClose={() => setEditing(null)}
                      onDone={() => {
                        setEditing(null);
                        reloadProducts();
                      }}
                    />
                  </li>
                ) : (
                  <li key={p.id} className={`flex gap-3 border border-line bg-ink2/40 p-3 ${p.active ? "" : "opacity-60"}`}>
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden bg-ink2">
                      {p.imagePath && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={siteImageUrl(p.imagePath) ?? ""} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="truncate text-[0.9375rem] text-chalk">{p.name}</p>
                      <p className="label mt-1 text-prize">{usd(p.priceCents)}</p>
                      <p className="label mt-1 text-silverfaint">
                        {p.sold} SOLD
                        {leftOf(p) !== null ? ` · ${leftOf(p)} LEFT` : ""}
                        {p.active ? "" : " · HIDDEN"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditing(p.id)}
                        disabled={editing !== null}
                        className="label mt-auto self-start pt-1 text-silverdim underline underline-offset-4 hover:text-chalk disabled:opacity-40"
                      >
                        EDIT
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
