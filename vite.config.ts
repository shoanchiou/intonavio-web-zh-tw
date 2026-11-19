import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    rollupOptions: { input: { main: "index.html", separate: "separate.html" } },
  },
  optimizeDeps: { exclude: ["web-audio-separation", "onnxruntime-web"] },
});
