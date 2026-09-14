"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js after the page has loaded, in production only - in
 * dev a cached chunk would fight hot reload. See public/sw.js for what it
 * caches and why it can never serve a stale deploy.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
