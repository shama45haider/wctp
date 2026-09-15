# WECAMETOOPARTY

Party ticketing and events site built with Next.js, deployed to GitHub Pages.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the site.

## Building

```bash
npm run build
```

Generates a static export in `./out`.

## Deployment

The site is automatically deployed to GitHub Pages when you push to `main`. See `.github/workflows/static.yml`.

## Project structure

- `app/` — Next.js app router pages: home, tickets, event pages, artists, sign-up and login, account, profile, the age check, the scanned-ticket page and the admin dashboard. There is no Partners page.
- `components/` — React components
- `lib/` — The account, cart and orders layer (`demo-account.tsx`, which keeps its old filename), the event list, ticket tiers and pricing, Instagram handle rules, and the Supabase data modules for profiles, orders, age checks and admin
- `supabase/` — `RUN_THIS.sql`, the whole outstanding schema in one paste for the SQL editor, `migrations/`, the same changes one file at a time, and `functions/`, the Deno functions Supabase runs server-side
- `public/` — Static assets
- `scripts/` — Build-time helpers (Instagram feed fetch)

## Age checks

Nothing about the age check is automatic. A guest sends a photo of their ID from `/verify`, blacking out anything they'd rather not share before it ever leaves their phone; an admin reads the redacted photo in the dashboard and approves or rejects it; the outcome is emailed from `events@wecametooparty.com`. Nothing in the browser can mark an account verified - only an admin approving a verifications row does.

Where a night happens is never on the site. The address is emailed to everyone on the list before each date.

## On a phone

The site installs to a home screen (`app/manifest.ts`, icons in `public/icons` and `public/apple-touch-icon.png`) and runs full-screen with a bottom tab bar. `public/sw.js` caches the hashed files under `/_next/static` and the last copy of each page, so repeat visits load from the phone and a dropped connection still shows something. Pages always try the network first, so a deploy is never hidden behind the cache; bump `VERSION` in `public/sw.js` only to throw every cached file away.

## Raffle

Run from the **RAFFLE** tab in `/admin`: title, description and prizes, whether it's on the site, whether it's taking entries, who has entered, and the live draw. The site's pop-up (`components/Raffle.tsx`) shows the newest raffle marked visible. A new raffle starts hidden, and opens the pop-up for everyone again once it's shown. Only accounts an admin has verified can enter, one entry each - enforced in the database by `0015_raffle.sql` and `0016_raffle_admin_live.sql`, both in `RUN_THIS.sql`.

**Live draw.** *Go live* closes entries and makes a link (`/raffle/live/?t=…`) that works for one hour, then shows "ended" to everyone. Anyone with it sees the wheel - every entrant's picture and handle - and the prizes. Signed in as an admin, the same page has a spin button for each place: the database picks the winner at random, and every open copy of the page spins to that same person within a few seconds. Nobody wins twice; *Clear & spin again* on a place is for a winner who isn't there.

## Editing page text

Signed in as an admin, every public page shows a small pencil after each piece of text; it opens an editor that saves to `public.site_copy` (migration `0014_site_copy.sql`, also in `RUN_THIS.sql`). The text in the code is the default - a saved edit replaces it for everyone, and "Reset to default" deletes the row. A button in the bottom-right corner hides the pencils when you want to see the page the way guests do. Event details are edited in `/admin/events`, and team cards and gallery photos have their own Edit buttons.

## Email

There are three kinds, and they are set up in different places.

**Proving an email before an account exists for it** — `/signup` sends a 6-digit code before asking for anything else, and the account cannot be created until that code is entered correctly. See "Verifying email before signup" below; it replaces the next item rather than sitting beside it.

**Sign-in and confirmation email** — the "confirm your address" and magic-link messages Supabase Auth sends on its own, without this project's code. Once the item above is deployed, turn this off under **Authentication → Providers → Email → Confirm email** - asking a guest to prove their address twice is worse than asking once. Until then (or if you decide not to use the code-based flow), point Supabase at a real sender under **Project Settings → Auth → SMTP Settings** (Resend works well here), and set **Authentication → URL Configuration** so **Site URL** is `https://wecametooparty.com` with `https://wecametooparty.com/**` in **Redirect URLs** — otherwise Supabase falls back to its default Site URL and the confirmation link in the email points at localhost.

**Email the site sends itself** — the address for a night, an age-check outcome. That goes through `supabase/functions/send-email`, a Deno function that calls Resend, with `lib/email.ts` as the caller on the site's side.

The API key never goes in this repo. The site is a static export, so anything a page imports is compiled into the bundle every visitor downloads — a key on that side is readable in devtools, and Resend refuses browser calls anyway. It lives as a secret on the function instead:

```bash
npx supabase secrets set RESEND_API_KEY=re_your_real_key
npx supabase functions deploy send-email --project-ref mkcuiglmsmxcchywruay
```

The function only sends for a caller whose user id is in the `admins` table. That is deliberate: the anon key this site ships is public, so "signed in" is a bar anyone can clear by signing up, and a function that mailed anything for any caller would be an open relay with this domain's return address on it.

Until the domain is verified in the Resend dashboard, mail goes out from `onboarding@resend.dev`, which only ever delivers to the address that owns the Resend account. Once `wecametooparty.com` is verified, set the sender:

```bash
npx supabase secrets set EMAIL_FROM="WECAMETOOPARTY <events@wecametooparty.com>"
```

### Verifying email before signup

Supabase's own "Confirm email" creates the account first and asks for confirmation after - the row exists the whole time it says "unconfirmed." `supabase/migrations/0013_verify_email_before_signup.sql` and the two functions below flip that order: an address has to answer a code sent to it before `signUp()` is allowed to succeed at all, enforced by a trigger that aborts the insert outright if it was skipped - not just a check in the page.

Run the migration (it is in `RUN_THIS.sql`), then deploy both functions and set the same secrets `send-email` already uses:

```bash
npx supabase functions deploy request-signup-code --project-ref mkcuiglmsmxcchywruay
npx supabase functions deploy verify-signup-code --project-ref mkcuiglmsmxcchywruay
```

Both need `RESEND_API_KEY` and, optionally, `EMAIL_FROM` - already set if `send-email` is deployed, since secrets are shared across every function in the project. They also need `SUPABASE_SERVICE_ROLE_KEY`, which Supabase sets on every Edge Function automatically; nothing to add there.

Once this is live, turn off Supabase's own "Confirm email" (**Authentication → Providers → Email**) - see the note above.

## Donate

`/donate` takes a real payment through Stripe Checkout - a guest never types a card number into this site. `components/DonateForm.tsx` asks `supabase/functions/create-donation-checkout` to start a session and sends the browser to the URL it returns; Stripe sends it back to `/donate` with `?success=1&session_id=…` or `?canceled=1`, and `donation-status` reads the session back from Stripe itself so the thank-you screen shows what was actually paid, not what the browser remembers typing before it left the site.

Anyone can give. `donation-status` also records each paid gift in `public.donations` (migration `0017`, in `RUN_THIS.sql`), keyed on the Stripe session so a reload can't count it twice. A donor who was signed in and left "Put me on the donor board" on shows up on the **Donor board** under the form - picture, @handle, nickname, total given and a Follow button to their Instagram, biggest total first. Guests' gifts are recorded but not shown, and emails, first names and ages never reach the board. Stripe's own dashboard is still the ledger for receipts and refunds.

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_live_your_real_key
npx supabase functions deploy create-donation-checkout --project-ref mkcuiglmsmxcchywruay
npx supabase functions deploy donation-status --project-ref mkcuiglmsmxcchywruay
```

Use a `sk_test_…` key first and pay with Stripe's [test card](https://stripe.com/docs/testing) `4242 4242 4242 4242`, any future expiry, any CVC, to prove the whole path end to end before switching to a live key. Nothing else to configure - both functions read the amount, name and email straight off the request, and the redirect back only ever lands on `wecametooparty.com` or `localhost:3000`, whichever the request came from.

## Password reset

"Forgot password?" on `/login` goes to `/reset-password`, which sends Supabase Auth's own reset email and, when the link brings the guest back, asks for the new password. It uses the email Supabase Auth already sends (the same SMTP settings as the confirmation email above), so nothing extra to deploy. **Authentication → URL Configuration → Redirect URLs** must include `https://wecametooparty.com/**`, or the link lands on the site root instead. The link only works in the browser it was requested from; to make it work on any device, change the Reset Password email template's link to `{{ .SiteURL }}/reset-password/?token_hash={{ .TokenHash }}&type=recovery`, which the page also accepts.
