"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/demo-account";
import { scanName, type ScanResult } from "@/lib/aamva";
import IdScanner from "@/components/IdScanner";
import IdDocumentUpload from "@/components/IdDocumentUpload";

/**
 * Age check.
 *
 * The licence path reads the PDF417 barcode on the back of the card in this
 * browser. Nothing is uploaded, and only the birth year and the name on the
 * card are kept - see markVerified.
 *
 * What that check establishes is that the barcode is well formed and says the
 * holder is over 18 - an expired card still says that, so expiry is shown but
 * never refuses someone on its own. It does not establish that the card is
 * genuine:
 * the payload is unsigned, and a browser cannot inspect the physical security
 * features that separate a real licence from a good copy. So the wording here
 * says "pre-checked", not "verified", and the card still gets looked at on the
 * night. Anything stronger needs a KYC provider that examines the document
 * itself and matches a face to it.
 */

const MIN_AGE = 18;

type Stage =
  | { k: "choose" }
  | { k: "scan" }
  | { k: "result"; scan: ScanResult }
  | { k: "other" }
  // Filed, not decided. The barcode path can clear somebody on the spot; a
  // photo of a student card cannot, and this stage exists so the two never
  // land on the same screen.
  | { k: "sent" }
  | { k: "done" };

export default function Verify() {
  const router = useRouter();
  const { ready, user, cart, markVerified } = useAccount();
  const [stage, setStage] = useState<Stage>({ k: "choose" });

  if (ready && !user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3rem)]">
          Sign in first
        </h1>
        <p className="mt-3 text-silverdim">
          You need an account before we can run the ID check.
        </p>
        <Link
          href="/login"
          className="font-display mt-6 inline-block border border-[rgba(200,16,46,0.5)] px-6 py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  const accept = (scan: ScanResult) => {
    if (!scan.ok || !scan.id.dob) return;
    markVerified(Number(scan.id.dob.slice(0, 4)), scanName(scan.id));
    setStage({ k: "done" });
  };

  return (
    <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
        {stage.k === "done"
          ? "You're cleared"
          : stage.k === "sent"
            ? "With us"
            : "Age check"}
      </h1>

      {stage.k === "choose" && (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            Our nights are {MIN_AGE}+. Scan the back of your licence and
            you&rsquo;re done in a second - or send another ID and we&rsquo;ll
            check it by hand.
          </p>
          <div className="mt-7 flex flex-col gap-3">
            <button
              onClick={() => setStage({ k: "scan" })}
              className="font-display min-h-11 border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi"
            >
              Scan my licence
            </button>
            <button
              onClick={() => setStage({ k: "other" })}
              className="font-display min-h-11 border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-colors hover:border-silverdim"
            >
              Use another ID
            </button>
          </div>
          <p className="label mt-6 leading-loose text-silverfaint">
            A LICENCE IS READ ON THIS DEVICE AND NEVER UPLOADED. WE KEEP YOUR
            BIRTH YEAR AND YOUR NAME - NOT YOUR ADDRESS OR DOCUMENT NUMBER.
          </p>
        </>
      )}

      {stage.k === "scan" && (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            Hold the <strong className="text-chalk">back</strong> of the card up
            to the camera - the barcode side, not the photo.
          </p>
          <IdScanner
            onResult={(scan) => setStage({ k: "result", scan })}
            onCancel={() => setStage({ k: "other" })}
          />
        </>
      )}

      {stage.k === "result" && <ScanOutcome scan={stage.scan} onAccept={accept} onRetry={() => setStage({ k: "scan" })} onOther={() => setStage({ k: "other" })} />}

      {/* The upload owns every word under this heading, including its own back
          control and the date-of-birth copy - it is the only thing that knows
          whether there is a session to file the photo against. A second lead
          paragraph or a second Back here would double both. */}
      {stage.k === "other" && (
        <IdDocumentUpload
          onSubmitted={() => setStage({ k: "sent" })}
          onBack={() => setStage({ k: "choose" })}
        />
      )}

      {stage.k === "sent" && (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            Your ID is in the queue. A person reads every one of these, so it is
            not instant - you&rsquo;ll hear back before the next date, and only
            the year of the date of birth you typed is kept.
          </p>
          <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
            <span className="text-silverfaint">ID STATUS</span>
            <span className="text-chalk">AWAITING REVIEW</span>
          </div>
          {/* Not "cleared". Nothing is approved until an admin says so, and the
              buttons below go on with the evening rather than promising it. */}
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => router.push(cart ? "/checkout" : "/tickets")}
              className="font-display min-h-11 border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-colors hover:border-silverdim"
            >
              {cart ? "Back to checkout" : "Browse tickets"}
            </button>
            <Link
              href="/account"
              className="font-display min-h-11 border border-line py-3 text-center tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
            >
              My account
            </Link>
          </div>
        </>
      )}

      {stage.k === "done" && (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
            {user?.name}, you&rsquo;re pre-checked for {MIN_AGE}+ nights. Bring
            the same ID - door staff still look at the card itself.
          </p>
          <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
            <span className="text-silverfaint">ID STATUS</span>
            <span className="text-bloodhi">PRE-CHECKED</span>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => router.push(cart ? "/checkout" : "/tickets")}
              className="font-display border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase hover:border-bloodhi"
            >
              {cart ? "Back to checkout" : "Browse tickets"}
            </button>
            <Link
              href="/account"
              className="font-display border border-linehi bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 text-center tracking-[0.12em] text-chalk uppercase hover:border-silverdim"
            >
              My account
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

/** What the scan found, and whether it clears the door. */
function ScanOutcome({
  scan,
  onAccept,
  onRetry,
  onOther,
}: {
  scan: ScanResult;
  onAccept: (s: ScanResult) => void;
  onRetry: () => void;
  onOther: () => void;
}) {
  if (!scan.ok) {
    return (
      <Refused
        title={scan.reason === "no-dob" ? "No date of birth" : "Not an ID"}
        body={
          scan.reason === "no-dob"
            ? "That barcode scanned, but carried no readable date of birth."
            : "That barcode is not a driver's licence or state ID."
        }
        onRetry={onRetry}
        onOther={onOther}
      />
    );
  }

  const { id, age } = scan;

  // Expired cards are accepted. All the door needs from this check is a birth
  // date over MIN_AGE; a licence past its own renewal date still carries a
  // genuine one. EXPIRES is still shown below so a person can see it.
  if (age === null || age < MIN_AGE) {
    return (
      <Refused
        title="Under 18"
        body="Our nights are 18+. Come back when the card says so."
        onRetry={onRetry}
        onOther={onOther}
      />
    );
  }

  return (
    <>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        Read off the card. Check it&rsquo;s you, then confirm.
      </p>
      <dl className="mt-6 border-t border-line">
        {[
          ["NAME", scanName(id)],
          ["DATE OF BIRTH", id.dob!],
          ["AGE", `${age}`],
          ["EXPIRES", id.expiry ?? "—"],
          ["ISSUED BY", id.jurisdiction || "—"],
        ].map(([k, v]) => (
          <div
            key={k}
            className="label flex items-baseline justify-between gap-4 border-b border-line py-3"
          >
            <dt className="text-silverfaint">{k}</dt>
            <dd className="text-right text-chalk">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="label mt-4 leading-loose text-silverfaint">
        ONLY YOUR NAME AND BIRTH YEAR ARE KEPT.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          onClick={() => onAccept(scan)}
          className="font-display min-h-11 border border-[rgba(200,16,46,0.5)] bg-gradient-to-b from-ink2 to-[#0a0b0e] py-3 tracking-[0.12em] text-chalk uppercase transition-all hover:border-bloodhi"
        >
          That&rsquo;s me
        </button>
        <button
          onClick={onRetry}
          className="font-display min-h-11 border border-line py-3 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
        >
          Scan again
        </button>
      </div>
    </>
  );
}

function Refused({
  title,
  body,
  onRetry,
  onOther,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  onOther: () => void;
}) {
  return (
    <>
      <div className="label mt-6 border border-[rgba(200,16,46,0.5)] px-4 py-4 leading-loose text-bloodhi">
        {title.toUpperCase()}
      </div>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-silverdim">
        {body}
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          onClick={onRetry}
          className="font-display min-h-11 border border-linehi py-3 tracking-[0.12em] text-chalk uppercase transition-colors hover:border-silverdim"
        >
          Scan again
        </button>
        <button
          onClick={onOther}
          className="font-display min-h-11 border border-line py-3 tracking-[0.12em] text-silverdim uppercase transition-colors hover:border-linehi hover:text-chalk"
        >
          Use another ID
        </button>
      </div>
    </>
  );
}
