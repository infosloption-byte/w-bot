import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/portal/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { customer: "index.html", platform: "platform.html" }
    }
  },
  server: { port: 5176, proxy: { "/portal/api": { target: "http://localhost:9028", changeOrigin: true } } }
});
