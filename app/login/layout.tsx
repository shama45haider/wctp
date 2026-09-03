import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accounts",
  description: "Sign in with the email on your account.",
  // The page it wraps is "use client" now, and Next 16 only honours a metadata
  // export from a Server Component - so this layout exists to carry it. Without
  // it the route inherits the site title and, worse, loses the noindex the
  // placeholder page had: a sign-in form is not something to serve to a crawler.
  robots: { index: false, follow: false },
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
