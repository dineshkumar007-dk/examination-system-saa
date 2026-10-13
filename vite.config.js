import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend/react",
  plugins: [react()],
  publicDir: false,
  build: { outDir: "../../public", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
