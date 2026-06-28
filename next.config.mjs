/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Vercel Lambda から public/fonts を fs で読めるように同梱
    outputFileTracingIncludes: {
      "/api/admin/invoice-batch-export": ["./public/fonts/**/*"],
    },
  },
};

export default nextConfig;
