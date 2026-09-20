import ChatRoom from "@/components/ChatRoom";
import XpBoard from "@/components/XpBoard";

/**
 * The lounge, with the board beside it.
 *
 * Two things people check rather than read: who is talking, and where they
 * stand. Side by side on a desk, stacked on a phone with the chat first -
 * the board is the thing you glance at, not the thing you came for.
 */
export default function Lounge() {
  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2rem,6vw,4rem)]">
      <h1 className="font-display chrome text-[clamp(2rem,8vw,3.25rem)] leading-[0.85]">
        Online Lounge
      </h1>
      <p className="mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed text-silverdim">
        Everyone with an account can read it. Posting needs your age checked.
      </p>

      <div className="mt-8 flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
        <ChatRoom />
        <XpBoard />
      </div>
    </main>
  );
}
