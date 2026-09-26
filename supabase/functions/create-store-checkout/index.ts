/**
 * Starts a real Stripe payment for a prize from the store.
 *
 * Priced here, from public.store_products, never from anything the browser
 * says about money - the same rule create-ticket-checkout follows. The buyer
 * has to be signed in: the prize QR lives on their account, and a guest who
 * closed the thank-you screen would have no way back to it.
 *
 * `invoice_creation` makes Stripe issue a real invoice for the payment, which
 * the buyer gets by email and which store_orders links to for the dashboard.
 * No order row is written here; one appears only once Stripe says it's paid.
 *
 *   npx supabase functions deploy create-store-checkout --use-api --project-ref mkcuiglmsmxcchywruay
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_ENDPOINT = "https://api.stripe.com/v1/checkout/sessions";

const ALLOWED_ORIGINS = new Set([
  "https://wecametooparty.com",
  "http://localhost:3000",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const MAX_QTY = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json({ error: "Payments are not configured." }, 500);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await asCaller.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Sign in to buy a prize." }, 401);

  let payload: { productId?: unknown; qty?: unknown; origin?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const productId = typeof payload.productId === "string" ? payload.productId : "";
  const qty = Number(payload.qty ?? 1);
  const origin = typeof payload.origin === "string" ? payload.origin : "";
  if (!productId) return json({ error: "Which prize?" }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    return json({ error: `Between 1 and ${MAX_QTY} at a time.` }, 400);
  }
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Bad origin." }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data: product, error: productErr } = await admin
    .from("store_products")
    .select("id, name, blurb, price_cents, image_path, stock, sold, active")
    .eq("id", productId)
    .maybeSingle();
  if (productErr) return json({ error: "Could not read the store." }, 500);
  if (!product || !product.active) return json({ error: "That prize isn't on sale." }, 400);

  if (product.stock !== null) {
    const left = (product.stock as number) - (product.sold as number);
    if (left <= 0) return json({ error: "Sold out." }, 400);
    if (qty > left) return json({ error: `Only ${left} left.` }, 400);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("email, name")
    .eq("id", user.id)
    .maybeSingle();

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${origin}/donate/?store=1&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/donate/?store=canceled`);
  const email = profile?.email || user.email;
  if (email) form.set("customer_email", String(email));
  form.set("phone_number_collection[enabled]", "true");

  form.set("line_items[0][quantity]", String(qty));
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(product.price_cents));
  form.set("line_items[0][price_data][product_data][name]", String(product.name));
  if (product.blurb) {
    form.set("line_items[0][price_data][product_data][description]", String(product.blurb).slice(0, 500));
  }
  if (product.image_path) {
    const img = admin.storage.from("site-images").getPublicUrl(product.image_path).data.publicUrl;
    if (img) form.set("line_items[0][price_data][product_data][images][0]", img);
  }

  // A real Stripe invoice for the payment, emailed to the buyer.
  form.set("invoice_creation[enabled]", "true");
  form.set("invoice_creation[invoice_data][description]", `WECAMETOOPARTY store - ${product.name}`);
  form.set(
    "invoice_creation[invoice_data][footer]",
    "Pick up your prize at the next event: show the QR on your account to a staff member.",
  );
  form.set("invoice_creation[invoice_data][metadata][kind]", "store");

  form.set("metadata[kind]", "store");
  form.set("metadata[user_id]", user.id);
  form.set("metadata[product_id]", String(product.id));
  form.set("metadata[product_name]", String(product.name));
  form.set("metadata[qty]", String(qty));

  const res = await fetch(STRIPE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const session = await res.json().catch(() => ({}));
  if (!res.ok || !session?.url) {
    return json({ error: session?.error?.message ?? "Stripe refused that." }, 502);
  }
  return json({ url: session.url });
});
