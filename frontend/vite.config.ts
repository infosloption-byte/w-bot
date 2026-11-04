import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/portal/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        customer: "index.html",
        platform: "platform.html",
        marketingHome: "marketing/index.html",
        marketingTranslation: "marketing/translation.html",
        marketingAlerts: "marketing/smart-alerts.html",
        marketingPricing: "marketing/pricing.html",
        marketingHow: "marketing/how-it-works.html",
        marketingFAQ: "marketing/faq.html",
        marketingTrust: "marketing/trust.html",
        marketingContact: "marketing/contact.html"
      }
    }
  },
  server: { port: 5176, proxy: { "/portal/api": { target: "http://localhost:9028", changeOrigin: true } } }
});
