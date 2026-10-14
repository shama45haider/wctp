/**
 * Shared control styling.
 *
 * The ticketing flow spans a picker, a four-step checkout and the account
 * pages; a "primary action" that drifts between them reads as three different
 * buttons. Plain strings rather than components so both server and client
 * files can use them, and so one-off tweaks stay a `className` away.
 */

export const field =
  "min-h-11 border border-line bg-[#0a0b0d] px-3.5 py-2.5 text-chalk transition-colors focus:border-silverdim focus:outline-none";

/** Shape and type every button shares; add a border and colours to make a variant. */
export const btnBase =
  "inline-flex min-h-12 items-center justify-center rounded-full py-3 px-6 text-[0.9375rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** Secondary: cancel, back, anything that is not the way forward. An outlined pill. */
export const btn = `${btnBase} border border-line-hi text-chalk hover:border-chalk`;

/** Primary: buy, confirm, continue. One per screen - a solid black pill. */
export const btnGo = `${btnBase} bg-prize text-void hover:bg-gold-hi`;

/** Row of small metadata pills and quiet links. */
export const tag =
  "label inline-flex items-center border border-line px-2.5 py-1 text-silverfaint";

/* ------------------------------------------------------------------ tables --
 *
 * The dashboard draws four tables - tiers, the guest list, the roster and the
 * age queue - and each had hand-written padding on every cell, so no two lined
 * up and a wide one could not be told from a dense one. These are the shared
 * rhythm.
 *
 * Numeric columns take `num`: tabular figures and right alignment, so a column
 * of money or counts can be compared by eye down the column rather than read
 * figure by figure.
 */

/** Wrapper that lets a wide table scroll sideways instead of squeezing. */
export const tableWrap = "overflow-x-auto";

export const tableEl = "w-full border-collapse text-left";

/** Header cell. Sticky so a long roster keeps its column names on screen. */
export const th =
  "label sticky top-0 z-10 bg-ink px-4 py-2.5 font-normal tracking-[0.11em] text-silverfaint uppercase";

/** Body cell. --line-soft between rows, so the panel's own edge stays louder. */
export const td = "border-t border-linesoft px-4 py-3 align-middle";

/** Numeric cell or header: right-aligned, tabular figures. */
export const num = "text-right tabular-nums";
