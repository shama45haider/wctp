import { org } from "@/lib/events";

export const metadata = { title: "Partners — WECAMETOOPARTY" };

// Venues and collaborators taken from real event records on Posh.
const collaborators = [
  { name: "Gems Bar & Lounge", detail: "BLACKOUT V · WECAMETOOCOSPLAY" },
  { name: "IMSAVIILOLIIBOYY", detail: "SAVII'S 21ST COLOR WAVE" },
  { name: "Furravia", detail: "WECAMETOOFURR" },
  { name: "Andy Kessler Skate Park", detail: "SLAVE TO DANCEFLOOR" },
  { name: "The Garden People", detail: "CUT THE WATER" },
  { name: "West Harlem Pier", detail: "MASTERTRIPSITTER'S BIRTHDAY BBQ" },
];

export default function Partners() {
  return (
    <main className="mx-auto w-[92vw] max-w-[1180px] py-[clamp(2.5rem,6vw,4.5rem)]">
      <h1 className="font-display chrome text-[clamp(2.5rem,8vw,6rem)] leading-[0.82]">
        Partners
      </h1>
      <p className="mt-5 max-w-[52ch] leading-relaxed text-silverdim">
        Venues, promoters and artists we&rsquo;ve built nights with. Want to put
        something on together? Reach us at{" "}
        <a
          href={org.instagram}
          target="_blank"
          rel="noopener"
          className="text-chalk underline decoration-blood underline-offset-4 hover:text-bloodhi"
        >
          {org.instagramHandle}
        </a>
        .
      </p>

      <div className="mt-12 border-t border-line">
        {collaborators.map((c) => (
          <div
            key={c.name}
            className="group relative flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-b border-line px-4 py-6 transition-colors hover:bg-white/[0.022]"
          >
            <span className="absolute inset-y-0 left-0 w-0.5 origin-top scale-y-0 bg-blood transition-transform group-hover:scale-y-100" />
            <h2 className="font-display text-[1.75rem]">{c.name}</h2>
            <span className="label text-silverfaint">{c.detail}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
