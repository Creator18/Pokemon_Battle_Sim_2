import { defineConfig } from 'vite';
import { recipeAssets } from './server/recipeAssets.mjs';

export default defineConfig({
  server: {
    port: 3000,
    // (docs/ — demos, tournament harnesses, bot brains — is fetched fresh by the page, never imported: a change there
    // must not reload the page mid-tournament.)
    watch: { ignored: ['**/docs/**'] },
  },
  build: {
    target: 'es2020',
  },
  // The recipe loader decodes models in a module worker that imports its
  // sibling modules.
  worker: {
    format: 'es',
  },
  // `public/` is served at the web root.
  publicDir: 'public',
  // Serves /recipe/<id>/… straight out of the Legends Z-A archives
  // ($POKEMON_ARCHIVES, default: the folder above this repo).
  plugins: [recipeAssets()],
});
