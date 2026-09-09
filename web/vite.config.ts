// vitest/config re-exports Vite's defineConfig with the `test` block typed,
// which keeps one config file instead of two that must be kept in sync.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Tailwind 4 is a Vite plugin, not a PostCSS pipeline — there is no
  // tailwind.config.js and no postcss.config.js in this project.
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
  },
});
