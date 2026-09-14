import type { Metadata } from "next";
import DonateForm from "@/components/DonateForm";
import { Editable } from "@/components/Editable";

export const metadata: Metadata = {
  title: "Donate · WECAMETOOPARTY",
  description:
    "Chip in for sound, lights and the next date. Not a ticket - just a gift.",
};

/**
 * Stays a server component for the metadata export above. The form itself
 * needs state (the amount, the simulated payment step), so it lives in
 * DonateForm, a client component, the same split every other page on this
 * site uses for the same reason.
 */
export default function Donate() {
  return (
    <main className="mx-auto w-[92vw] max-w-[460px] py-[clamp(2.5rem,8vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2.5rem,9vw,4rem)] leading-[0.85]">
        <Editable k="donate.heading">Donate</Editable>
      </h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
        <Editable k="donate.intro">
          Not a ticket - this buys nobody entry and holds no spot. It goes
          straight to sound, lights and getting the next date on. Give whatever
          you want.
        </Editable>
      </p>

      <DonateForm />
    </main>
  );
}
