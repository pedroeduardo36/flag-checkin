/** @type {import('next').NextConfig} */
// Files face recognition loads from disk at runtime
// (Vercel's dependency tracer can't see them on its own).
const faceFiles = [
  "./node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model*",
  "./node_modules/@vladmandic/face-api/model/face_landmark_68_model*",
  "./node_modules/@vladmandic/face-api/model/face_recognition_model*",
  "./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm",
];

const nextConfig = {
  // TensorFlow.js runs straight from node_modules, bypassing the bundler.
  serverExternalPackages: ["@vladmandic/face-api", "@tensorflow/tfjs", "@tensorflow/tfjs-backend-wasm"],
  outputFileTracingIncludes: {
    "/api/checkin/confirmar": faceFiles,
    "/api/health": [...faceFiles, "./public/brand/flag-logo.jpg"],
  },
  // Camera and geolocation only work over HTTPS (or on localhost).
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
