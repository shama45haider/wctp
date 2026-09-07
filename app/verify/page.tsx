"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/demo-account";
import { atHandle } from "@/lib/handle";
import { btn, btnGo } from "@/lib/ui";
import IdDocumentUpload from "@/components/IdDocumentUpload";

/**
 * Age check.
 *
 * One path, and a slow one on purpose: a photo of an ID, with whatever the
 * guest would rather not share blacked out, goes into a queue that a person
 * reads in app/admin. Nothing on this page, or anywhere else in the browser,
 * can mark anyone verified. There used to be a barcode reader here that
 * cleared a licence holder on the spot; it could not tell a real card from a
 * good copy, and it is gone.
 *
 * So the page has four faces and only reads its way between them: no session,
 * cleared, waiting on a review, or nothing on file (which a refusal counts
 * as - the reviewer's note is shown and they are asked to send another).
 * `ready` from useAccount already waits for the profile row, so `verified`
 * and `check` can be trusted the moment it turns true. The one thing decided
 * locally is that a check just filed shows as waiting straight away, rather
 * than after the re-read lands.
 */

const MIN_AGE = 18;

export default function Verify() {
  const router = useRouter();
  const { ready, user, cart, refreshProfile } = useAccount();
  const [sent, setSent] = useState(false);

  if (!ready) {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
        <p className="label text-silverfaint">LOADING…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto w-[92vw] max-w-[420px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3rem)]">
          Sign in first
        </h1>
        <p className="mt-3 text-silverdim">
          You need an account before we can run the age check - it is how we
          know whose ID it is, and where to write back.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link href="/login" className={btnGo}>
            Sign in
          </Link>
          <Link href="/signup" className={btn}>
            Make an account
          </Link>
        </div>
      </main>
    );
  }

  // A legacy account that never gave a handle is still called by whatever it
  // signed up with, and putting an @ in front of that would invent one.
  const who = user.instagram ? atHandle(user.name) : user.name;
  const pending = sent || user.check?.status === "pending";
  const refused = !pending && user.check?.status === "rejected";

  const onward = (
    <div className="mt-6 flex flex-col gap-3">
      <button
        onClick={() => router.push(cart ? "/checkout" : "/tickets")}
        className={btnGo}
      >
        {cart ? "Back to checkout" : "Browse tickets"}
      </button>
      <Link href="/account" className={btn}>
        My account
      </Link>
    </div>
  );

  if (user.verified) {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
          You&rsquo;re cleared
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          {who}, you&rsquo;re verified for {MIN_AGE}+ nights. Bring the same
          ID - the door still looks at the card itself.
        </p>
        <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
          <span className="text-silverfaint">AGE CHECK</span>
          <span className="text-bloodhi">VERIFIED</span>
        </div>
        {onward}
      </main>
    );
  }

  if (pending) {
    return (
      <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
        <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
          With us
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
          Your ID is in the queue. A person reads every one of these, so it is
          not instant.
        </p>
        <div className="label mt-6 flex items-center justify-between border border-line px-3 py-3">
          <span className="text-silverfaint">AGE CHECK</span>
          <span className="text-chalk">AWAITING REVIEW</span>
        </div>
        {/* Not "cleared". Nothing is approved until an admin says so, and the
            buttons go on with the evening rather than promising it. */}
        {onward}
      </main>
    );
  }

  return (
    <main className="mx-auto w-[92vw] max-w-[440px] py-[clamp(2.5rem,7vw,5rem)]">
      <h1 className="font-display chrome text-[clamp(2rem,6vw,3.25rem)] leading-[0.85]">
        Age check
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-silverdim">
        Our nights are {MIN_AGE}+. Send a photo of your ID and a person will
        check it. You can black out anything on it except your photo, your name
        and your date of birth.
      </p>

      {refused && user.check && (
        <div className="mt-6 border border-[rgba(200,16,46,0.5)] px-4 py-4">
          <p className="label leading-loose text-bloodhi">
            YOUR LAST CHECK WAS REFUSED
          </p>
          {user.check.note && (
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-chalk">
              {user.check.note}
            </p>
          )}
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-silverdim">
            Send another.
          </p>
        </div>
      )}

      {/* The upload owns every word under this, including its own Back: it is
          the only thing that knows which of its steps the guest is on. Shown
          as waiting the moment it reports success, and the profile is re-read
          behind that so the rest of the site catches up. */}
      <IdDocumentUpload
        onSubmitted={() => {
          setSent(true);
          refreshProfile();
        }}
        onBack={() => router.push(cart ? "/checkout" : "/account")}
      />
    </main>
  );
}
