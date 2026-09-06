/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: "/loyalty",
  env: {
    // Read by app/base.js for the client-side fetch() calls, which Next.js
    // does not rewrite automatically the way it does <Link>/router paths.
    NEXT_PUBLIC_BASE_PATH: "/loyalty",
  },
};

export default nextConfig;
