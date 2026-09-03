Images for the "Official Instagram" grid on the home page.

Drop JPGs or PNGs here and list them in `data/instagram-posts.json`:

    [
      { "file": "01.jpg", "permalink": "https://www.instagram.com/p/ABC123/", "caption": "wecametoofurr" }
    ]

`file` is the only required key. `permalink` is where the tile links to, and
falls back to the account page. Entries whose image is missing are skipped with
a warning at build time rather than shipping a broken square.

These are committed rather than hotlinked from Instagram's CDN on purpose: CDN
URLs carry an expiring signature and go dead within days, and the build keeps
passing while the grid empties, which is the hardest kind of breakage to spot.

If IG_USER_ID and IG_ACCESS_TOKEN are set, the Graph API is used instead and
this directory is ignored.
