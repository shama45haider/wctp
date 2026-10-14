"use client";

import { useState } from "react";
import { btn } from "@/lib/ui";

/**
 * Shows a long list a batch at a time, so a page on a phone is a few screens
 * long rather than dozens. `resetKey` starts the count over when the list
 * itself changes - a new filter or search - without an effect.
 */
export function useShowMore<T>(items: T[], step: number, resetKey = "") {
  const [state, setState] = useState({ key: resetKey, count: step });
  const count = state.key === resetKey ? state.count : step;
  return {
    visible: items.slice(0, count),
    remaining: Math.max(0, items.length - count),
    showMore: () => setState({ key: resetKey, count: count + step }),
  };
}

/** The button under a batched list. Draws nothing once everything is shown. */
export function ShowMoreButton({
  remaining,
  onClick,
  label = "Show more",
}: {
  remaining: number;
  onClick: () => void;
  label?: string;
}) {
  if (remaining <= 0) return null;
  return (
    <button type="button" onClick={onClick} className={`${btn} mt-6 w-full`}>
      {label} <span className="text-silverdim">({remaining} more)</span>
    </button>
  );
}
