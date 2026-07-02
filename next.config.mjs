/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Vercel Lambda から public/fonts を fs で読めるように同梱
    outputFileTracingIncludes: {
      "/api/admin/invoice-batch-export": ["./lib/pdf-fonts/**/*", "./public/fonts/**/*"],
      "/api/admin/invoice-bulk-zip": ["./lib/pdf-fonts/**/*", "./public/fonts/**/*"],
      "/api/member/combined-pdf": ["./lib/pdf-fonts/**/*", "./public/fonts/**/*"],
    },
  },
};

export default nextConfig;
