/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tier 5 reads the pipeline CSVs client-side from /public/data. A thin API route arrives with Tier 6.
};

export default nextConfig;
