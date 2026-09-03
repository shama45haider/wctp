/**
 * Self-contained ticket tokens.
 *
 * There is no server behind this site, so a scanned code cannot be looked up:
 * an order exists only in the buyer's own localStorage, on the buyer's own
 * phone. For a QR to mean anything to the person holding the scanner, the
 * ticket has to travel inside the QR itself.
 *
 * So the payload carries who the ticket belongs to, and /pass renders it. Event
 * title, venue and date are NOT carried - /pass looks those up from the static
 * event list by slug, which keeps the QR small enough to scan across a dark
 * room.
 *
 * The digest makes edits evident, not impossible. Anyone can read this file,
 * so anyone determined can recompute it after changing `a` from 1 to 4; what it
 * stops is the casual edit of a URL. A ticket that cannot be forged needs a
 * server-held key signing it, and that is a backend decision, not a client one.
 */

export type PassToken = {
  /** Format version, so a future change can be told apart from a corrupt code. */
  v: 1;
  /** Pass code, e.g. WCTP-A1B2C3-GA. */
  c: string;
  /** Name the ticket was issued to. */
  n: string;
  /** Event slug - /pass resolves the rest from the static event list. */
  e: string;
  /** Tier name, carried rather than looked up so a renamed tier stays truthful. */
  t: string;
  /** How many people this one pass admits. */
  a: number;
  /** Order id, so door staff can tie several passes back to one buyer. */
  o: string;
  /** Issued at, epoch ms - shorter than an ISO string, and only ever displayed. */
  i: number;
};

/**
 * Fields in a fixed order, joined by an explicit separator.
 *
 * The order fixes the digest so it never depends on key ordering. The separator
 * fixes the boundaries: joined bare, a name of "AB" with slug "C" and a name of
 * "A" with slug "BC" produce the same string and so the same digest. U+001F is
 * written as an escape on purpose - as a literal byte it is invisible in an
 * editor, and anyone tidying what looks like join("") would silently invalidate
 * every ticket already in a guest's camera roll.
 */
function canonical(t: Omit<PassToken, "v">) {
  return [t.c, t.n, t.e, t.t, t.a, t.o, t.i].join("\u001f");
}

/**
 * FNV-1a, 32-bit, hex. Not a secure MAC and not trying to be - see the note at
 * the top of the file. It is here to catch a hand-edited payload.
 */
function digest(input: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** base64url over UTF-8, so names outside ASCII survive the round trip. */
function b64urlEncode(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodePass(t: Omit<PassToken, "v">) {
  const body = { v: 1 as const, ...t };
  return b64urlEncode(JSON.stringify(body) + "." + digest(canonical(t)));
}

export type DecodedPass =
  | { ok: true; pass: PassToken }
  | { ok: false; reason: "unreadable" | "tampered" | "version" };

export function decodePass(encoded: string): DecodedPass {
  let raw: string;
  try {
    raw = b64urlDecode(encoded);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const cut = raw.lastIndexOf(".");
  if (cut === -1) return { ok: false, reason: "unreadable" };

  let body: PassToken;
  try {
    body = JSON.parse(raw.slice(0, cut));
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  if (body?.v !== 1) return { ok: false, reason: "version" };
  if (typeof body.c !== "string" || typeof body.n !== "string") {
    return { ok: false, reason: "unreadable" };
  }
  if (digest(canonical(body)) !== raw.slice(cut + 1)) {
    return { ok: false, reason: "tampered" };
  }
  return { ok: true, pass: body };
}

/**
 * Absolute URL for a pass.
 *
 * The payload goes in the fragment, never the query string: it carries a
 * guest's name, and a fragment is not sent to the host, so it stays out of
 * access logs and out of the Referer header on any link the page later opens.
 */
export function passUrl(t: Omit<PassToken, "v">, origin: string) {
  return `${origin}/pass#${encodePass(t)}`;
}
