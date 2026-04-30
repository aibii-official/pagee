import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

const knowledgePage = new URL('./src/ui/knowledge/index.html', import.meta.url).pathname;

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        knowledge: knowledgePage
      }
    }
  }
});
