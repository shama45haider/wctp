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

Nothing about the age check is automatic. A guest sends a photo of their ID from `/verify`, blacking out anything they'd rather not share before it ever leaves their phone; an admin reads the redacted photo in the dashboard and approves or rejects it; the outcome is emailed from `party@wecametooparty.com`. Nothing in the browser can mark an account verified - only an admin approving a verifications row does.

Where a night happens is never on the site. The address is emailed to everyone on the list before each date.

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
npx supabase secrets set EMAIL_FROM="WECAMETOOPARTY <party@wecametooparty.com>"
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
