"use client";

import { useEffect, useState } from "react";
import { TODAY } from "./events";

/**
 * The real date, corrected in the browser after the first paint.
 *
 * This is a static export with no server behind it - every page is built
 * once and then served as-is, so the only "now" baked into the HTML is
 * whatever instant the site last happened to be built at. `TODAY` in
 * lib/events.ts is that frozen guess, and it used to be the only answer
 * anything on the site ever got: an event's date could sail past it for
 * days before someone remembered to move the archive by hand, and the home
 * page kept pointing at whatever was "next" the day of the last deploy.
 *
 * Every page still renders against `TODAY` first, so the very first paint
 * matches what the static export shipped and hydration has nothing to
 * disagree with - the same reason useRuntimeEvents seeds itself with the
 * built-in list before its own fetch has answered. This hook then corrects
 * that guess to the visitor's own clock the moment the page has mounted,
 * which is what actually moves a date that has passed into the archive and
 * promotes whatever is genuinely soonest to "next" - no rebuild required.
 *
 * It keeps checking once a minute after that, so a tab left open across
 * midnight catches the rollover on its own. The check only ever causes a
 * re-render on the tick where the calendar date has actually changed - at
 * most once a day - so the cost of "automatic" here is one comparison a
 * minute, not a render a minute.
 */
export function useNow(): Date {
  const [now, setNow] = useState(TODAY);

  useEffect(() => {
    const check = () => {
      setNow((prev) => {
        const real = new Date();
        return real.toDateString() === prev.toDateString() ? prev : real;
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  return now;
}
