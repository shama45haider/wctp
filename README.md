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

- `app/` — Next.js app router pages
- `components/` — React components
- `lib/` — Utilities (tickets, demo account, Posh scraping)
- `public/` — Static assets
- `scripts/` — Build-time helpers (Instagram feed fetch)
