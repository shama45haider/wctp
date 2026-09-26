import type { Metadata } from "next";
import DonateForm from "@/components/DonateForm";
import DonorBoard from "@/components/DonorBoard";
import { Editable } from "@/components/Editable";
import StoreFront from "@/components/StoreFront";
import { tag } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Store · WECAMETOOPARTY",
  description:
    "Little prizes that keep the nights running - buy online, pick up at the next event. Or just donate and get on the donor board.",
};

const IMPACT_KEYS = [
  { k: "donate.impact.sound", label: "SOUND" },
  { k: "donate.impact.lights", label: "LIGHTS" },
  { k: "donate.impact.next", label: "THE NEXT DATE" },
];

const STEPS = [
  { k: "store.step.pick", title: "Pick a prize", body: "Everything here funds the next night." },
  { k: "store.step.pay", title: "Pay by card", body: "Stripe takes it and emails your invoice." },
  { k: "store.step.pickup", title: "Pick it up", body: "Show your QR to staff at the next event." },
];

/**
 * The store first, the plain gift second. Stays a server component for the
 * metadata export above; the shelf, the form and the board all need state,
 * so they live in client components - the same split every other page on
 * this site uses for the same reason. The URL stays /donate so every link
 * already out there still lands here.
 */
export default function Donate() {
  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,7vw,4.5rem)]">
      <div className="border-b border-line pb-8">
        <p className="label text-prize">
          <Editable k="store.eyebrow">PRIZES FOR THE CAUSE · PICK UP AT THE NEXT EVENT</Editable>
        </p>
        <h1 className="font-display chrome mt-2 text-[clamp(2.75rem,10vw,5.5rem)] leading-[0.82]">
          <Editable k="store.heading">The Store</Editable>
        </h1>
        <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-silverdim">
          <Editable k="store.intro">
            Little prizes, made for the family. Every one keeps the sound on and the lights up -
            buy it here, then grab it from us at the next date.
          </Editable>
        </p>

        <ol className="mt-7 grid grid-cols-3 gap-2 [counter-reset:store-step] sm:gap-3">
          {STEPS.map((s) => (
            <li
              key={s.k}
              className="store-step flex flex-col items-start gap-2 border border-line bg-ink px-3 py-3 sm:flex-row sm:gap-4 sm:px-4 sm:py-4"
            >
              <div className="min-w-0">
                <p className="font-display text-[1rem] leading-tight text-chalk sm:text-[1.2rem]">
                  <Editable k={`${s.k}.title`}>{s.title}</Editable>
                </p>
                <p className="mt-1 hidden text-[0.8125rem] leading-snug text-silverdim sm:block">
                  <Editable k={`${s.k}.body`}>{s.body}</Editable>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <StoreFront />

      <section
        aria-labelledby="give-title"
        className="mt-16 grid gap-10 border-t border-line pt-12 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-14"
      >
        <div>
          <p className="label text-bloodhi">
            <Editable k="donate.eyebrow">NOT A TICKET · JUST A GIFT</Editable>
          </p>
          <h2
            id="give-title"
            className="font-display chrome mt-2 text-[clamp(2.25rem,8vw,3.25rem)] leading-[0.85]"
          >
            <Editable k="donate.give.heading">Or just donate</Editable>
          </h2>
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
        </div>

        <div className="lg:[&>section]:mt-0">
          <DonorBoard />
        </div>
      </section>
    </main>
  );
}
