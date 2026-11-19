import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["web-audio-separation", "onnxruntime-web"] },
});
