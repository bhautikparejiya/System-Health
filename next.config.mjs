import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  // PGlite (local dev database) ships WASM files and must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The schema is read at runtime and applied automatically on first use.
  outputFileTracingIncludes: { "/**": ["./db/schema.sql"] },
  // No X-Frame-Options / frame-ancestors restriction on purpose: the app is shown inside
  // HighLevel as an iframe, and white-label agencies serve HighLevel from their own domains.
};

export default nextConfig;
