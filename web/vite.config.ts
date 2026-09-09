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
  build: {
    rollupOptions: {
      output: {
        // Split the dependencies that never change from the application code,
        // so shipping a fix does not invalidate the framework bundle in every
        // user's cache. Rollup 4 takes the function form only.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id))
            return 'react';
          if (id.includes('@tanstack')) return 'query';
          if (/[\/](react-hook-form|@hookform|zod)[\/]/.test(id)) return 'forms';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    // jsdom plus userEvent's inter-keystroke delay is slow, and several test
    // files run in parallel. The default 5s is tight enough on a loaded machine
    // to make a passing assertion look like a failure.
    testTimeout: 15_000,
  },
});
