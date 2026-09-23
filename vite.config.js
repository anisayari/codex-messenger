import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const developmentCsp = {
  name: "messenger-development-csp",
  apply: "serve",
  transformIndexHtml(html) {
    // Vite inserts its React Refresh preamble inline only in development.
    return html.replace(/script-src[^;]+;/, "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';");
  }
};

export default defineConfig({
  base: "./",
  plugins: [react(), developmentCsp]
});
