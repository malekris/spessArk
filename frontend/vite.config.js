import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.jpg", "**/*.png", "**/*.jpeg"],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("heic2any")) return "heic-tools";
          if (id.includes("jspdf") || id.includes("jspdf-autotable")) return "pdf-tools";
          if (id.includes("html2canvas")) return "capture-tools";
          if (id.includes("react-router-dom")) return "router";
          if (id.includes("socket.io-client")) return "realtime";
          if (id.includes("recharts")) return "charts";
          return undefined;
        },
      },
    },
  },

  server: {
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
