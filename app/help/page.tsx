import type { Metadata } from "next";
import { Editable } from "@/components/Editable";
import HelpLinks from "@/components/HelpLinks";
import { org } from "@/lib/events";

export const metadata: Metadata = {
  title: "Help · WECAMETOOPARTY",
  description:
    "Every WECAMETOOPARTY link in one place - Instagram, tickets, TikTok - plus the policy for every event.",
};

/**
 * Links first, like a link-in-bio page, then the policy every event runs by.
 * Stays a server component for the metadata above; the link list needs the
 * admin's saved values, so it's a client component. Every sentence here is
 * editable in place by an admin.
 */

const POLICY = [
  {
    k: "refunds",
    title: "Refunds",
    body: "Every sale is final unless WeCameTooParty decides otherwise. Refunds, credits and exchanges are solely at WeCameTooParty’s discretion - and being removed from an event doesn’t qualify you for one.",
  },
  {
    k: "guests",
    title: "You represent your guests",
    body: "When you bring people in on your tickets, you’re responsible for them. If one person in your party gets kicked out, your whole party leaves with them.",
  },
  {
    k: "id",
    title: "We can ID you at any time",
    body: "Our events are 18+. Even if your account is already verified, we have the right to check your ID again at the door or at any point during the night. No valid ID, no entry.",
  },
  {
    k: "entry",
    title: "Right to refuse entry",
    body: "We can refuse entry to or remove anyone, at any time, whose behavior puts our guests, our staff or the venue at risk.",
  },
  {
    k: "agree",
    title: "Coming means you agree",
    body: "Buying a ticket or RSVPing to any WeCameTooParty event means you agree to this policy.",
  },
];

export default function Help() {
  return (
    <main className="mx-auto flex w-[92vw] max-w-[520px] flex-col items-center py-[clamp(2.5rem,8vw,4.5rem)] text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-192.png"
        alt=""
        width={96}
        height={96}
        className="h-24 w-24 rounded-full border-2 border-linehi object-cover shadow-[0_18px_50px_-20px_rgba(200,16,46,0.55)]"
      />
      <h1 className="font-display chrome mt-5 text-[clamp(2rem,8vw,2.75rem)] leading-[0.9]">
        {org.name}
      </h1>
      <p className="label mt-2 text-silverdim">{org.instagramHandle}</p>
      <p className="mt-3 max-w-[38ch] text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="help.tagline">Everything we’re on, in one place. Tap a link.</Editable>
      </p>

      <HelpLinks />

      <section aria-labelledby="policy-title" className="mt-16 w-full text-left">
        <p className="label text-bloodhi">
          <Editable k="help.policy.eyebrow">READ BEFORE YOU COME</Editable>
        </p>
        <h2
          id="policy-title"
          className="font-display chrome mt-2 text-[clamp(2rem,7vw,2.75rem)] leading-[0.9]"
        >
          <Editable k="help.policy.title">Event policy</Editable>
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="help.policy.intro">
            These rules apply to every WeCameTooParty event.
          </Editable>
        </p>

        <ol className="mt-6 flex flex-col gap-3">
          {POLICY.map((p, i) => (
            <li key={p.k} className="border border-line bg-ink p-4 sm:p-5">
              <div className="flex items-baseline gap-3">
                <span className="label shrink-0 text-bloodhi">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-[1.35rem] leading-tight">
                  <Editable k={`help.policy.${p.k}.title`}>{p.title}</Editable>
                </h3>
              </div>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-silverdim">
                <Editable k={`help.policy.${p.k}.body`}>{p.body}</Editable>
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="help.policy.contact">Questions about a night or a ticket? Email</Editable>{" "}
          <a
            href={`mailto:${org.email}`}
            className="text-chalk underline decoration-line underline-offset-4 transition-colors hover:text-bloodhi hover:decoration-bloodhi"
          >
            {org.email}
          </a>
        </p>
      </section>
    </main>
  );
}
