/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lucide is a barrel package; this avoids flaky dev/HMR issues (e.g. "__webpack_modules__[moduleId] is not a function")
  // and improves tree-shaking. See https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports
  experimental: {
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
