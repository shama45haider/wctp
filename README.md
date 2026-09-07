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
- `supabase/` — `RUN_THIS.sql`, the whole outstanding schema in one paste for the SQL editor, and `migrations/`, the same changes one file at a time
- `public/` — Static assets
- `scripts/` — Build-time helpers (Instagram feed fetch)

## Age checks

Nothing about the age check is automatic. A guest sends a photo of their ID from `/verify`, blacking out anything they'd rather not share before it ever leaves their phone; an admin reads the redacted photo in the dashboard and approves or rejects it; the outcome is emailed from `party@wecametooparty.com`. Nothing in the browser can mark an account verified - only an admin approving a verifications row does.

Where a night happens is never on the site. The address is emailed to everyone on the list before each date.
