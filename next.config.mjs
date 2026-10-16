/** @type {import('next').NextConfig} */
const nextConfig = {
  // A câmera e a geolocalização só funcionam em HTTPS (ou localhost).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self)" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
