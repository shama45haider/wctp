/**
 * Instagram handles, as the site stores and shows them.
 *
 * An account is its Instagram handle: the name on the profile, the name on the
 * ticket, the name the door reads off a screen. So the handle has to be one
 * thing everywhere, and this is where that is decided. Stored without the @,
 * lowercased - Instagram treats case as decoration, and "@Ragevvs" and
 * "ragevvs" must land on the same account. Shown with the @ put back.
 */

/**
 * What Instagram itself allows: up to 30 of letters, digits, underscores and
 * full stops. Nothing else, and not empty.
 */
const HANDLE = /^[a-z0-9._]{1,30}$/;

/**
 * The handle in stored form, or null when the input is not one.
 *
 * Takes what people actually type: a leading @, surrounding whitespace, a full
 * instagram.com link pasted from the app. All of those come back as the bare
 * lowercase handle.
 */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // A pasted profile link: https://www.instagram.com/someone/?hl=en
  const link = /instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (link) s = link[1];
  s = s.replace(/^@+/, "").replace(/\/+$/, "").toLowerCase();
  return HANDLE.test(s) ? s : null;
}

/** "@handle" for display. Empty input stays empty rather than becoming "@". */
export function atHandle(handle: string | null | undefined): string {
  if (!handle) return "";
  return `@${handle.replace(/^@+/, "")}`;
}

/** What is wrong with a typed handle, or null when it will do. */
export function handleProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Your Instagram handle is how the door knows you. Put it in.";
  if (normalizeHandle(s)) return null;
  const bare = s.replace(/^@+/, "");
  if (bare.length > 30) return "Instagram handles are 30 characters at most.";
  return "Letters, numbers, underscores and full stops only - the way it is on Instagram.";
}
