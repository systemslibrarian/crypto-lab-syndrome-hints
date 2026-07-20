import { defineConfig } from 'vite';

// GitHub Pages serves this project at /crypto-lab-syndrome-hints/ (the repo
// name). Keep this in sync with the repo / deploy URL.
export default defineConfig({
  base: '/crypto-lab-syndrome-hints/',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
