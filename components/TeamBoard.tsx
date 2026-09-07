"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES, isFilled, type Role } from "@/lib/artists";
import { org } from "@/lib/events";
import { asset } from "@/lib/asset";
import { useSupabaseAuth } from "@/lib/supabase-auth";
import {
  MAX_IMAGE_BYTES,
  resetTeamMember,
  saveTeamMember,
  uploadSiteImage,
  useTeam,
  type TeamMember,
  type TeamPatch,
} from "@/lib/site-content";
import { btn, btnGo, field } from "@/lib/ui";

/**
 * The roster page, and the roster page's own editor.
 *
 * The cards are drawn from useTeam rather than from lib/artists directly, so
 * the bundled roster is the floor and anything saved into team_members lands
 * on top of it. The bundle is what the static export ships and what useTeam
 * seeds itself with, so the first client render is the same page the HTML
 * already contains and hydration has nothing to disagree with; the saved
 * version replaces it a moment later, on the visitor's own browser.
 *
 * Editing lives here instead of on a separate dashboard page because the
 * owner asked to change a card while looking at it. Nothing about that is
 * trusted: useSupabaseAuth decides what to draw, and the same rule is
 * enforced again by row-level security, which refuses the write regardless of
 * what got onto the screen. Admin controls also wait for `ready`, so a guest
 * never sees an Edit button flash past while the session is still resolving.
 */

const pad = (n: number) => String(n).padStart(2, "0");

const labelOf = (role: Role) => ROLES.find((r) => r.id === role)!.label;

/**
 * A plain img rather than next/image for every photo on this page.
 *
 * Half the cards now point at the site-images bucket and a photo being
 * replaced points at a blob: URL, neither of which next/image will take -
 * remote hosts have to be listed in next.config.ts and a blob has no host at
 * all. The static export has no optimizer behind it either, so `fill` was
 * only ever laying out an ordinary img anyway.
 */
const Photo = ({ src, alt }: { src: string; alt: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={asset(src)}
    alt={alt}
    loading="lazy"
    decoding="async"
    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
  />
);

/** The corner affordance an admin taps to open a card's editor. */
function EditTab({ onEdit, slot }: { onEdit: () => void; slot: number }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="label absolute top-0 right-0 z-10 flex min-h-11 items-center bg-void/85 px-3 text-silver transition-colors hover:text-bloodhi"
    >
      EDIT <span className="sr-only">slot {pad(slot)}</span>
    </button>
  );
}

function FilledCard({ a, onEdit }: { a: TeamMember; onEdit?: () => void }) {
  return (
    <article className="group relative border border-line bg-ink transition-colors hover:border-linehi">
      <div className="relative aspect-[4/5] overflow-hidden">
        {a.imageUrl ? (
          <Photo src={a.imageUrl} alt={a.name!} />
        ) : (
          <div className="label flex h-full items-center justify-center bg-ink2 text-silverfaint">
            NO PHOTO
          </div>
        )}
        <span className="label absolute top-0 left-0 bg-void/85 px-2 py-1 text-silverfaint">
          {pad(a.slot)}
        </span>
        {/* Only an admin ever sees this card at all once it is hidden, so the
            badge is what tells them why nobody else can. */}
        {!a.published && (
          <span className="label absolute bottom-0 left-0 bg-void/85 px-2 py-1 text-bloodhi">
            HIDDEN
          </span>
        )}
        {onEdit && <EditTab onEdit={onEdit} slot={a.slot} />}
      </div>

      <div className="px-5 pt-4 pb-6">
        <h3 className="font-display text-[1.6rem]">{a.name}</h3>
        <div className="label mt-1 text-bloodhi">{labelOf(a.role)}</div>
        {a.title && (
          <div className="label mt-1 text-silverdim">{a.title.toUpperCase()}</div>
        )}
        {a.bio && (
          <p className="mt-3 text-sm leading-relaxed text-silverdim">{a.bio}</p>
        )}
        {(a.instagram || a.soundcloud) && (
          <div className="label mt-4 flex gap-5 border-t border-line pt-1">
            {a.instagram && (
              <a
                href={a.instagram}
                target="_blank"
                rel="noopener"
                className="inline-block py-3 text-silverfaint transition-colors hover:text-chalk"
              >
                INSTAGRAM
              </a>
            )}
            {a.soundcloud && (
              <a
                href={a.soundcloud}
                target="_blank"
                rel="noopener"
                className="inline-block py-3 text-silverfaint transition-colors hover:text-chalk"
              >
                SOUNDCLOUD
              </a>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function EmptySlot({ a, onEdit }: { a: TeamMember; onEdit?: () => void }) {
  return (
    <article className="relative border border-dashed border-linehi bg-ink/40">
      <div className="hairline-x relative flex aspect-[4/5] items-center justify-center opacity-25" />
      <span className="font-display absolute top-3 left-4 text-[2.5rem] leading-none text-linehi">
        {pad(a.slot)}
      </span>
      {onEdit && <EditTab onEdit={onEdit} slot={a.slot} />}
      <div className="border-t border-dashed border-linehi px-5 pt-4 pb-6">
        <h3 className="font-display text-[1.6rem] text-silverfaint">
          Slot {pad(a.slot)}
        </h3>
        <p className="label mt-2 leading-loose text-silverfaint">
          {labelOf(a.role)} &middot; ANNOUNCING SOON
        </p>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- editor -- */

type Draft = {
  role: Role;
  name: string;
  title: string;
  bio: string;
  instagram: string;
  soundcloud: string;
  published: boolean;
};

const draftOf = (m: TeamMember | undefined, fallbackRole: Role): Draft => ({
  role: m?.role ?? fallbackRole,
  name: m?.name ?? "",
  title: m?.title ?? "",
  bio: m?.bio ?? "",
  instagram: m?.instagram ?? "",
  soundcloud: m?.soundcloud ?? "",
  published: m?.published ?? true,
});

const MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

/**
 * One card's fields, opened in the card's own place in the grid rather than
 * over the page.
 *
 * A dialog would need a focus trap, a scroll lock and somewhere to put a form
 * this tall on a 375px screen; taking over the grid cell needs none of that,
 * and the grid is a single column at that width anyway, so the editor is
 * already full-bleed on a phone with the page scrolling normally underneath
 * a thumb. On a wide screen it spans the whole row so the fields are not
 * squeezed into a quarter of it.
 */
function SlotEditor({
  slot,
  member,
  fallbackRole,
  onSaved,
  onClose,
}: {
  slot: number;
  member?: TeamMember;
  fallbackRole: Role;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(member, fallbackRole));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<"saving" | "restoring" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A blob URL outlives the img that used it, so the one on screen is revoked
  // the moment it is replaced and again when the editor closes.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const id = (key: string) => `slot-${slot}-${key}`;

  const pick = (chosen: File | null) => {
    setFile(chosen);
    setPreview(chosen ? URL.createObjectURL(chosen) : null);
    setError(null);
  };

  const shown = preview ?? member?.imageUrl ?? null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy("saving");
    setError(null);

    // The upload first, because a row pointing at a file that never arrived
    // is a broken card, while a file with no row is only bytes in a bucket.
    let imagePath: string | undefined;
    if (file) {
      const up = await uploadSiteImage(file, "team");
      if (!alive.current) return;
      if (!up.path) {
        setBusy(null);
        setError(up.error ?? "The photo did not upload.");
        return;
      }
      imagePath = up.path;
    }

    const patch: TeamPatch = {
      role: draft.role,
      name: draft.name,
      title: draft.title,
      bio: draft.bio,
      instagram: draft.instagram,
      soundcloud: draft.soundcloud,
      published: draft.published,
    };
    // Left out entirely when no new photo was chosen, so saving a name does
    // not wipe the picture that is already there.
    if (imagePath) patch.imagePath = imagePath;

    const out = await saveTeamMember(slot, patch);
    if (!alive.current) return;
    setBusy(null);
    if (!out.ok) {
      setError(out.error ?? "The save did not go through.");
      return;
    }
    onSaved();
  };

  const restore = async () => {
    setConfirming(false);
    setBusy("restoring");
    setError(null);

    const out = await resetTeamMember(slot);
    if (!alive.current) return;
    setBusy(null);
    if (!out.ok) {
      setError(out.error ?? "The reset did not go through.");
      return;
    }
    onSaved();
  };

  return (
    <article className="border border-linehi bg-ink2 sm:col-span-2 lg:col-span-4">
      <form onSubmit={save} className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <span className="label text-silverfaint">
            EDITING SLOT {pad(slot)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="label min-h-11 text-silverfaint transition-colors hover:text-chalk"
          >
            CLOSE
          </button>
        </div>

        <div>
          <label htmlFor={id("name")} className="label text-silverfaint">
            NAME
          </label>
          <input
            id={id("name")}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Leave empty for ANNOUNCING SOON"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor={id("title")} className="label text-silverfaint">
            TITLE
          </label>
          <input
            id={id("title")}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Founder, Resident, a crew"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor={id("role")} className="label text-silverfaint">
            SECTION
          </label>
          <select
            id={id("role")}
            value={draft.role}
            onChange={(e) => set("role", e.target.value as Role)}
            className={`${field} mt-2 w-full`}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.heading}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={id("bio")} className="label text-silverfaint">
            BIO
          </label>
          <textarea
            id={id("bio")}
            value={draft.bio}
            onChange={(e) => set("bio", e.target.value)}
            rows={3}
            className={`${field} mt-2 w-full resize-y`}
          />
        </div>

        <div>
          <label htmlFor={id("instagram")} className="label text-silverfaint">
            INSTAGRAM URL
          </label>
          <input
            id={id("instagram")}
            value={draft.instagram}
            onChange={(e) => set("instagram", e.target.value)}
            inputMode="url"
            placeholder="https://www.instagram.com/â€¦"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <label htmlFor={id("soundcloud")} className="label text-silverfaint">
            SOUNDCLOUD URL
          </label>
          <input
            id={id("soundcloud")}
            value={draft.soundcloud}
            onChange={(e) => set("soundcloud", e.target.value)}
            inputMode="url"
            placeholder="https://soundcloud.com/â€¦"
            className={`${field} mt-2 w-full`}
          />
        </div>

        <div>
          <span className="label text-silverfaint">PHOTO</span>
          <div className="mt-2 flex items-start gap-4">
            <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden border border-line bg-ink">
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset(shown)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="label flex h-full items-center justify-center text-silverfaint">
                  NONE
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input
                id={id("photo")}
                type="file"
                accept="image/*"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
                className={`${field} w-full text-sm`}
              />
              <p className="label mt-2 text-silverfaint">
                {file
                  ? "NOT UPLOADED UNTIL YOU SAVE"
                  : `CHOOSE A FILE TO REPLACE IT. ${MB} MB MAX.`}
              </p>
            </div>
          </div>
        </div>

        <div>
          <label
            htmlFor={id("published")}
            className="label flex min-h-11 cursor-pointer items-center gap-3 border border-line px-3.5 text-chalk"
          >
            <input
              id={id("published")}
              type="checkbox"
              checked={draft.published}
              onChange={(e) => set("published", e.target.checked)}
              className="h-4 w-4 accent-blood"
            />
            SHOW ON THE SITE
          </label>
          <p className="label mt-2 text-silverfaint">
            TURNING THIS OFF TAKES THE CARD OFF THE PAGE FOR EVERYONE, THIS
            SCREEN INCLUDED.
          </p>
        </div>

        {error && (
          <p className="label leading-loose text-bloodhi" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy !== null}
            className={`${btnGo} flex-1`}
          >
            {busy === "saving" ? "Savingâ€¦" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className={btn}
          >
            Cancel
          </button>
        </div>

        {/* Only worth offering where there is an edit to undo. A slot the
            bundle never had has nothing to fall back to, and dropping its row
            would leave nothing at all. */}
        {member?.fromDb && (
          <div className="border-t border-line pt-4">
            {confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="label leading-loose text-silverdim">
                  THIS THROWS AWAY THE EDITS AND PUTS BACK WHATEVER SLOT{" "}
                  {pad(slot)} SHIPPED WITH. NOBODY IS DELETED.
                </p>
                <button
                  type="button"
                  onClick={() => void restore()}
                  disabled={busy !== null}
                  className="label min-h-11 border border-[rgba(200,16,46,0.5)] px-3 text-bloodhi transition-colors hover:border-bloodhi disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "restoring" ? "RESETTINGâ€¦" : "RESET IT"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
                >
                  KEEP THE EDITS
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy !== null}
                className="label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-silverdim hover:text-chalk disabled:cursor-not-allowed disabled:opacity-50"
              >
                RESET TO DEFAULT
              </button>
            )}
          </div>
        )}
      </form>
    </article>
  );
}

/* ------------------------------------------------------------------ page -- */

export default function TeamBoard() {
  const { ready, isAdmin } = useSupabaseAuth();
  const { members: allMembers, error, reload } = useTeam();
  const [open, setOpen] = useState<number | null>(null);

  const canEdit = ready && isAdmin;
  // Read through the gate rather than stored behind it, so signing out with a
  // card open closes it instead of leaving a form on screen that the database
  // would refuse anyway.
  const editing = canEdit ? open : null;

  // A hidden slot is off the page for everyone except the person who can put
  // it back. useTeam hands them all over precisely so this decision lives
  // here: filtering them out further down would take the Edit button with
  // them and leave no way to undo the hiding.
  const members = canEdit ? allMembers : allMembers.filter((m) => m.published);

  const announced = members.filter(isFilled).length;
  const editingMember = members.find((m) => m.slot === editing);
  // Open on a slot that is not on the roster: the "add a slot" case, which has
  // no card to expand into and so gets a panel of its own under the header.
  const addingNew = editing !== null && !editingMember;
  const nextSlot = members.reduce((max, m) => Math.max(max, m.slot), 0) + 1;

  const done = () => {
    setOpen(null);
    reload();
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <div className="flex flex-col items-start gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div>
          <h1 className="font-display chrome text-[clamp(2.5rem,8vw,5.5rem)] leading-[0.82]">
            Meet The Team
          </h1>
          <p className="mt-4 max-w-[46ch] leading-relaxed text-silverdim">
            The people behind the nights. Want on the roster? Reach us at{" "}
            <a
              href={org.instagram}
              target="_blank"
              rel="noopener"
              className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
            >
              {org.instagramHandle}
            </a>{" "}
            or{" "}
            <a
              href={`mailto:${org.email}`}
              className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
            >
              {org.email}
            </a>
            .
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:shrink-0 sm:items-end">
          <div className="label text-silverfaint">
            {pad(announced)} OF {pad(members.length)} ANNOUNCED
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setOpen(nextSlot)}
              className="label min-h-11 border border-line px-3 text-silverdim transition-colors hover:border-silverdim hover:text-chalk"
            >
              + ADD A SLOT
            </button>
          )}
        </div>
      </div>

      {/* A roster that failed to load is not a guest's problem - the bundled
          one is a whole page on its own, and always was - but an admin about
          to edit needs to know the saved version never arrived. */}
      {canEdit && error && (
        <p className="label mt-6 leading-loose text-bloodhi" role="alert">
          {error}
        </p>
      )}

      {addingNew && editing !== null && (
        <div className="mt-8">
          <SlotEditor
            key={`new-${editing}`}
            slot={editing}
            fallbackRole="artist"
            onSaved={done}
            onClose={() => setOpen(null)}
          />
        </div>
      )}

      {/* One section per role, in ROLES order. Every section shares the same
          four-column grid so a card is the same width all the way down the
          page; the two-card CEO and DJ sections simply fill two of the four
          columns on a wide screen rather than stretching to a different size. */}
      {ROLES.map((r) => {
        const slots = members.filter((m) => m.role === r.id);
        return (
          <section key={r.id} id={`${r.id}s`} className="mt-12 scroll-mt-28">
            <div className="mb-6 border-b border-line pb-4">
              <h2 className="font-display text-[clamp(1.9rem,5vw,3rem)]">
                {r.heading}
              </h2>
              <p className="mt-2 max-w-[42ch] text-silverdim">{r.blurb}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {slots.map((a) =>
                editing === a.slot ? (
                  <SlotEditor
                    key={a.slot}
                    slot={a.slot}
                    member={a}
                    fallbackRole={a.role}
                    onSaved={done}
                    onClose={() => setOpen(null)}
                  />
                ) : isFilled(a) ? (
                  <FilledCard
                    key={a.slot}
                    a={a}
                    onEdit={canEdit ? () => setOpen(a.slot) : undefined}
                  />
                ) : (
                  <EmptySlot
                    key={a.slot}
                    a={a}
                    onEdit={canEdit ? () => setOpen(a.slot) : undefined}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
