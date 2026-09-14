import type { Metadata } from "next";
import DonateForm from "@/components/DonateForm";
import { Editable } from "@/components/Editable";
import { tag } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Donate · WECAMETOOPARTY",
  description:
    "Chip in for sound, lights and the next date. Not a ticket - just a gift.",
};

const IMPACT_KEYS = [
  { k: "donate.impact.sound", label: "SOUND" },
  { k: "donate.impact.lights", label: "LIGHTS" },
  { k: "donate.impact.next", label: "THE NEXT DATE" },
];

/**
 * Stays a server component for the metadata export above. The form itself
 * needs state (the amount, the Stripe redirect), so it lives in DonateForm,
 * a client component, the same split every other page on this site uses for
 * the same reason.
 */
export default function Donate() {
  return (
    <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(2.5rem,8vw,5rem)]">
      <p className="label text-bloodhi">
        <Editable k="donate.eyebrow">NOT A TICKET · JUST A GIFT</Editable>
      </p>
      <h1 className="font-display chrome mt-2 text-[clamp(2.5rem,9vw,4rem)] leading-[0.85]">
        <Editable k="donate.heading">Donate</Editable>
      </h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="donate.intro">
          Buys nobody entry and holds no spot - it goes straight into keeping
          the nights running. Give whatever you want.
        </Editable>
      </p>

      <ul className="mt-4 flex flex-wrap gap-2">
        {IMPACT_KEYS.map((item) => (
          <li key={item.k} className={tag}>
            <Editable k={item.k}>{item.label}</Editable>
          </li>
        ))}
      </ul>

      <DonateForm />
    </main>
  );
}
