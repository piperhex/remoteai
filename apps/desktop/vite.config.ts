import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { imageEditorPlugin } from '../../shared/chat/imageEditorPlugin';
import { fontSizePlugin } from '../../shared/appearance/fontSizePlugin';

export default defineConfig({
  plugins: [react(), imageEditorPlugin()],
  css: { postcss: { plugins: [fontSizePlugin()] } },
  clearScreen: false,
  resolve: { dedupe: ['react', 'react-dom', 'antd', 'antd-mobile', '@ant-design/cssinjs', '@remoteai/i18n'] },
  optimizeDeps: { include: ['pdfjs-dist/legacy/build/pdf.mjs'] },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    rollupOptions: { input: { main: "index.html", quickMenu: "quick-menu.html" } },
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
