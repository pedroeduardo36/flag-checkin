/** @type {import('next').NextConfig} */
// Arquivos que o reconhecimento facial carrega do disco em tempo de execução
// (o rastreador de dependências da Vercel não os enxerga sozinho).
const faceFiles = [
  "./node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model*",
  "./node_modules/@vladmandic/face-api/model/face_landmark_68_model*",
  "./node_modules/@vladmandic/face-api/model/face_recognition_model*",
  "./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm",
];

const nextConfig = {
  // TensorFlow.js roda direto do node_modules, sem passar pelo bundler.
  serverExternalPackages: ["@vladmandic/face-api", "@tensorflow/tfjs", "@tensorflow/tfjs-backend-wasm"],
  outputFileTracingIncludes: {
    "/api/checkin/confirmar": faceFiles,
    "/api/health": [...faceFiles, "./public/brand/flag-logo.jpg"],
  },
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
