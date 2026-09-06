"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, which is what turns the site into an installable
 * app. Renders nothing.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Scope must cover the whole app, which lives under the basePath.
    navigator.serviceWorker
      .register("/loyalty/sw.js", { scope: "/loyalty/" })
      .catch(() => {
        // Not fatal — the app works fine without offline support.
      });
  }, []);

  return null;
}
