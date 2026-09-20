"use client";

import { useEffect, useRef, useState } from "react";
import { Editable } from "./Editable";
import { getSupabase } from "@/lib/supabase";
import { setBoardVisible } from "@/lib/xp";

/**
 * Whether you appear on the public XP board.
 *
 * On by default, because a board nobody is on ranks nobody. Off is one tap,
 * and it is here rather than buried in the board itself - this is the page
 * where the rest of what other people can see about you is decided.
 *
 * Reads the current value straight off the profile row rather than taking it
 * as a prop: /profile loads its own profile through a different path, and one
 * of the two would end up stale.
 */
export default function BoardOptOut() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const supabase = getSupabase();
        if (!supabase) return;
        const { data } = await supabase.auth.getSession();
        const me = data.session?.user.id;
        if (!me) return;
        const { data: row } = await supabase
          .from("profiles")
          .select("show_on_leaderboard")
          .eq("id", me)
          .maybeSingle();
        if (!alive.current) return;
        // Absent column or absent row both mean 0021 has not run, or the
        // default has never been written. Visible is the default either way.
        setOn(row?.show_on_leaderboard ?? true);
      } catch {
        if (alive.current) setOn(true);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  if (on === null) return null;

  const flip = async () => {
    const next = !on;
    setBusy(true);
    setSaid(null);
    // Moved first so the switch answers the tap; put back if the write refuses.
    setOn(next);
    const out = await setBoardVisible(next);
    if (!alive.current) return;
    setBusy(false);
    if (!out.ok) {
      setOn(!next);
      setSaid(out.error ?? "That did not save.");
    }
  };

  return (
    <div className="mt-7 border border-line px-4 py-3.5">
      <label
        htmlFor="board"
        className="label flex min-h-11 cursor-pointer items-center gap-3 text-chalk uppercase"
      >
        <input
          id="board"
          type="checkbox"
          checked={on}
          onChange={() => void flip()}
          disabled={busy}
          className="h-4 w-4 accent-blood"
        />
        <Editable k="profile.board.label">Show me on the board</Editable>
      </label>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-silverfaint">
        <Editable k="profile.board.note">
          Your handle and score, nothing else. Never which nights you went to.
        </Editable>
      </p>
      {said && (
        <p className="mt-2 text-[0.8125rem] text-bloodhi" role="alert">
          {said}
        </p>
      )}
    </div>
  );
}
