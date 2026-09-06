"use client";

// Mirrors next.config.mjs's basePath. Next.js rewrites <Link>/router paths
// automatically but not hand-written fetch() calls, so every client-side
// fetch to our own API goes through this instead of a bare "/api/...".
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function apiUrl(path) {
  return `${BASE_PATH}${path}`;
}
