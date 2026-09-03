"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { btnGo, field } from "@/lib/ui";

/**
 * Door tools.
 *
 * Read this before trusting it: there is no server, so this passphrase is in
 * the JavaScript bundle and anyone who opens devtools can read it. It keeps a
 * curious guest out of the door screen. It is not access control, and nothing
 * behind it is a secret - the scan list lives in this browser and describes
 * only what this device has scanned. Real admin auth arrives with the backend.
 */

const PASSPHRASE = "wctp-door";
const UNLOCK_KEY = "wctp.admin";
const SCAN_KEY = "wctp.scanned";

export default function Admin() {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [scans, setScans] = useState<[string, string][]>([]);

  const loadScans = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(SCAN_KEY) ?? "{}");
      const rows = Object.entries(raw) as [string, string][];
      rows.sort((a, b) => b[1].localeCompare(a[1]));
      setScans(rows);
    } catch {
      setScans([]);
    }
  };

  useEffect(() => {
    // sessionStorage, so closing the tab re-locks the door phone.
    const open = sessionStorage.getItem(UNLOCK_KEY) === "1";
    setUnlocked(open);
    setReady(true);
    if (open) loadScans();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (entry.trim() !== PASSPHRASE) return setError(true);
    sessionStorage.setItem(UNLOCK_KEY, "1");
    setUnlocked(true);
    setError(false);
    loadScans();
  };

  const clearScans = () => {
    localStorage.removeItem(SCAN_KEY);
    setScans([]);
  };

  if (!ready) return null;

  if (!unlocked) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(3rem,10vw,6rem)]">
        <span className="label border border-line px-3 py-2 text-silverfaint">
          STAFF ONLY
        </span>
        <h1 className="font-display chrome mt-7 text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
          Admin
        </h1>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
          Door tools for checking tickets on the night.
        </p>

        <form className="mt-7" onSubmit={submit}>
          <label htmlFor="pass" className="label text-silverfaint">
            PASSPHRASE
          </label>
          <input
            id="pass"
            type="password"
            value={entry}
            onChange={(e) => {
              setEntry(e.target.value);
              setError(false);
            }}
            className={`${field} mt-2 w-full`}
          />
          {error && (
            <p className="label mt-3 text-bloodhi" role="alert">
              NOT RECOGNISED
            </p>
          )}
          <button type="submit" className={`${btnGo} mt-6 w-full`}>
            Unlock
          </button>
        </form>

        <p className="label mt-6 leading-loose text-silverfaint">
          THIS GATE RUNS IN THE BROWSER AND IS NOT SECURITY. IT HOLDS NOTHING
          SECRET - ONLY WHAT THIS DEVICE HAS SCANNED.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[560px] py-[clamp(2.5rem,8vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
        Door
      </h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
        Point any phone camera at a ticket QR. It opens the ticket, shows whose
        name is on it, and offers to mark it used.
      </p>

      <div className="label mt-7 flex items-center justify-between border-y border-line py-3">
        <span className="text-silverfaint">SCANNED ON THIS DEVICE</span>
        <span className="text-chalk">{scans.length}</span>
      </div>

      {scans.length === 0 ? (
        <p className="label mt-5 text-silverfaint">
          NOTHING SCANNED YET TONIGHT.
        </p>
      ) : (
        <ul className="mt-5">
          {scans.map(([code, at]) => (
            <li
              key={code}
              className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
            >
              <span className="break-all text-chalk">{code}</span>
              <span className="whitespace-nowrap text-silverfaint">
                {new Date(at).toLocaleString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex flex-col gap-3">
        {scans.length > 0 && (
          <button
            onClick={clearScans}
            className="font-display border border-line py-3 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-[rgba(200,16,46,0.5)] hover:text-bloodhi"
          >
            Clear scan list
          </button>
        )}
        <button
          onClick={() => {
            sessionStorage.removeItem(UNLOCK_KEY);
            setUnlocked(false);
            setEntry("");
          }}
          className="font-display border border-linehi py-3 tracking-[0.12em] text-chalk uppercase transition-colors hover:border-silverdim"
        >
          Lock
        </button>
        <Link href="/" className="label mt-2 text-center text-silverfaint hover:text-chalk">
          &larr; BACK HOME
        </Link>
      </div>
    </main>
  );
}
