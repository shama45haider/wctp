/**
 * Parser for the PDF417 barcode on the back of North American driver's licences
 * and state IDs (the AAMVA DL/ID card standard).
 *
 * Read this before trusting the output. Decoding this barcode tells you the
 * barcode is well formed. It does NOT tell you the card is real: the data is
 * unsigned, and software that writes a scannable AAMVA barcode is widely
 * available. A browser cannot see holograms, UV features or card stock, and it
 * cannot tell whether the person holding the card is the person named on it.
 * Treat a successful parse as "these are the details the card claims", and
 * leave authenticity to the human looking at the physical card at the door.
 */

export type IdScan = {
  firstName: string;
  middleName: string;
  lastName: string;
  /** ISO yyyy-mm-dd, or null when the card carried no readable date. */
  dob: string | null;
  expiry: string | null;
  issued: string | null;
  sex: "M" | "F" | "X" | null;
  address: string;
  city: string;
  state: string;
  postal: string;
  licenseNumber: string;
  /** Two-letter issuing jurisdiction where the card gave one. */
  jurisdiction: string;
};

export type ScanResult =
  | { ok: true; id: IdScan; age: number | null; expired: boolean }
  | { ok: false; reason: "not-an-id" | "no-dob" };

/**
 * AAMVA element codes. Only the ones worth showing a door or filling a profile
 * with - the standard defines many more (height, eye colour, endorsements) that
 * a guest list has no business keeping.
 */
const FIELDS = {
  DCS: "lastName",
  DAC: "firstName",
  DAD: "middleName",
  DBB: "dob",
  DBA: "expiry",
  DBD: "issued",
  DBC: "sex",
  DAG: "address",
  DAI: "city",
  DAJ: "state",
  DAK: "postal",
  DAQ: "licenseNumber",
} as const;

/**
 * AAMVA dates are eight digits in one of two orders, and which one depends on
 * the issuing country rather than anything in the payload. The orders are
 * distinguishable: a month cannot exceed 12, so a leading four digits that read
 * as a plausible year can only be a year.
 */
function parseDate(raw: string): string | null {
  const s = raw.replace(/\D/g, "");
  if (s.length !== 8) return null;

  const lead = Number(s.slice(0, 4));
  const [y, m, d] =
    lead >= 1900 && lead <= 2100
      ? [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)] // CCYYMMDD - Canada
      : [s.slice(4, 8), s.slice(0, 2), s.slice(2, 4)]; // MMDDCCYY - US

  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

function parseSex(raw: string): IdScan["sex"] {
  const v = raw.trim();
  if (v === "1" || v.toUpperCase() === "M") return "M";
  if (v === "2" || v.toUpperCase() === "F") return "F";
  return v ? "X" : null;
}

/** Whole years elapsed, counting the birthday itself. */
export function ageOn(dobIso: string, on = new Date()): number | null {
  const dob = new Date(`${dobIso}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Pull elements out by scanning for their codes rather than by following the
 * header's offset table. The offsets are routinely wrong in the field - several
 * jurisdictions miscount them - and a parser that trusts them fails on real
 * cards that every commercial scanner reads without complaint.
 */
export function parseAamva(raw: string): ScanResult {
  if (!raw || !/ANSI |AAMVA/i.test(raw.slice(0, 64))) {
    // Cheap early out: this is some other barcode entirely.
    if (!/\bD[AB][A-Z]/.test(raw)) return { ok: false, reason: "not-an-id" };
  }

  const found: Record<string, string> = {};
  for (const segment of raw.split(/[\r\n]+/)) {
    // A subfile's first line carries its type ("DL" or "ID") before the first
    // element, so drop that prefix when an element code follows it.
    const line = segment.replace(/^(?:DL|ID)(?=[A-Z]{3})/, "");
    const code = line.slice(0, 3).toUpperCase();
    if (code in FIELDS) {
      found[code] = line.slice(3).trim();
      continue;
    }

    // The header line ends with the subfile designators and then runs straight
    // into the first element with no break - "...ZV03190008DLDAQT64235789". A
    // line that does not start with an element code may still contain the first
    // one, so pick it up from wherever it begins.
    const embedded = line.match(
      new RegExp(`(${Object.keys(FIELDS).join("|")})(.*)$`),
    );
    if (embedded) found[embedded[1]] ??= embedded[2].trim();
  }

  if (Object.keys(found).length === 0) return { ok: false, reason: "not-an-id" };

  const get = (code: keyof typeof FIELDS) => found[code] ?? "";

  const dob = parseDate(get("DBB"));
  if (!dob) return { ok: false, reason: "no-dob" };

  const expiry = parseDate(get("DBA"));

  const id: IdScan = {
    firstName: get("DAC"),
    middleName: get("DAD"),
    lastName: get("DCS"),
    dob,
    expiry,
    issued: parseDate(get("DBD")),
    sex: parseSex(get("DBC")),
    address: get("DAG"),
    city: get("DAI"),
    state: get("DAJ"),
    postal: get("DAK").replace(/0000$/, ""),
    licenseNumber: get("DAQ"),
    jurisdiction: get("DAJ"),
  };

  return {
    ok: true,
    id,
    age: ageOn(dob),
    expired: expiry ? new Date(`${expiry}T00:00:00`) < new Date() : false,
  };
}

/** Display name from a scan, in the order a person would write it. */
export function scanName(id: IdScan) {
  return [id.firstName, id.middleName, id.lastName]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
