import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/doudou-studio/",
  plugins: [react()],
  build: {
    outDir: "pages-dist",
    emptyOutDir: true,
  },
});
