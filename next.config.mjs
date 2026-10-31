import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
// Content Security Policy — enforced: anything outside these allowlists is blocked.
// To debug a new third-party integration, temporarily rename the header below to
// "Content-Security-Policy-Report-Only" (logs violations to the console, blocks nothing).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseWs = supabaseUrl.replace(/^https:/, "wss:");
// Dev-only: React Refresh / HMR evaluate code; production builds do not need eval.
const scriptEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
const csp = [
  "default-src 'self'",
  // Next.js injects inline scripts; tighten with nonces later.
  `script-src 'self' 'unsafe-inline'${scriptEval} https://us-assets.i.posthog.com https://apis.google.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Email bodies, Drive thumbnails, avatars and logos load from arbitrary https hosts.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://*.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://us.i.posthog.com https://us-assets.i.posthog.com https://api.logo.dev`,
  // Docs/Sheets/Drive previews, attachment previews (blob:) and the sandboxed email iframe (srcdoc).
  "frame-src 'self' blob: data: https://docs.google.com https://drive.google.com https://*.google.com https://calendar.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" },
];

const nextConfig = {
  // A package-lock.json also exists in the parent folder; pin tracing to this project.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Lucide is a barrel package; this avoids flaky dev/HMR issues (e.g. "__webpack_modules__[moduleId] is not a function")
  // and improves tree-shaking. See https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports
  experimental: {
    // Next 15 stopped caching client-side navigations by default; keep Next 14's windows so
    // moving between pages doesn't refetch every time.
    staleTimes: { dynamic: 30, static: 300 },
    optimizePackageImports: ["lucide-react"],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/pagefile.sys",
          "**/hiberfil.sys",
          "**/swapfile.sys",
          "**/DumpStack.log.tmp",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
