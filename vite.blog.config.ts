import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/doudou/",
  plugins: [react()],
  build: {
    outDir: "blog-dist",
    emptyOutDir: true,
  },
});
