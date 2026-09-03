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

const btnBase =
  "font-display inline-flex min-h-11 items-center justify-center py-[0.7rem] px-[1.15rem] tracking-[0.12em] uppercase transition-all disabled:cursor-not-allowed disabled:opacity-50";

/** Secondary: cancel, back, anything that is not the way forward. */
export const btn = `${btnBase} border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] text-chalk hover:border-silverdim`;

/** Primary: buy, confirm, continue. One per screen. */
export const btnGo = `${btnBase} border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] text-chalk hover:border-bloodhi hover:shadow-[0_10px_34px_-12px_rgba(200,16,46,0.6)]`;

/** Row of small metadata pills and quiet links. */
export const tag =
  "label inline-flex items-center border border-line px-2.5 py-1 text-silverfaint";
