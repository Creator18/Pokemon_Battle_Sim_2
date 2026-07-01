import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    target: 'es2020',
  },
  // `public/` is served at the web root, so `public/assets/models/*.glb`
  // resolves to `/assets/models/*.glb` at runtime (used by PokemonFactory).
  publicDir: 'public',
});
