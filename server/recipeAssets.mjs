// Vite plugin: serve each Pokémon's raw model files straight out of the Legends
// Z-A archives, so the browser can build the models at runtime ("the recipe")
// and nothing is ever extracted to disk.
//
//   GET /recipe/<id>/manifest     -> { id, files: [name, ...] }   (no shiny, no locators)
//   GET /recipe/<id>/file/<name>  -> raw bytes of one file of that form
//
// The archives (ZA-Poke.zip, ZA-PokeDLC.zip, ZA-PokeAnim.zip,
// ZA-PokeAnimDLC.zip) are looked for in $POKEMON_ARCHIVES, else the folder above
// this repo. The index is built on the first request (~0.2 s) and kept.
import fs from 'fs';
import path from 'path';
import { openZip } from './zip.mjs';

const ARCHIVES = ['ZA-Poke.zip', 'ZA-PokeDLC.zip', 'ZA-PokeAnim.zip', 'ZA-PokeAnimDLC.zip'];

function buildIndex(dir) {
  const index = new Map(); // id -> Map(file -> { zip, entry })
  let found = 0;
  for (const a of ARCHIVES) {
    const p = path.join(dir, a);
    if (!fs.existsSync(p)) continue;
    found++;
    const z = openZip(p);
    for (const entry of z.names()) {
      if (entry.includes('/locators/')) continue;
      const m = entry.match(/\/(pm\d{4}_\d\d_\d\d)\/((pm\d{4}_\d\d_\d\d)[^/]*)$/);
      if (!m || m[1] !== m[3]) continue;
      const [, id, file] = m;
      if (file.startsWith(`${id}_rare`)) continue; // the shiny
      if (!index.has(id)) index.set(id, new Map());
      index.get(id).set(file, { zip: z, entry });
    }
  }
  return { index, found };
}

export function recipeAssets({ archives } = {}) {
  let state = null;
  const dir = () => path.resolve(archives || process.env.POKEMON_ARCHIVES || path.resolve(process.cwd(), '..'));
  const ensure = () => {
    if (!state) {
      const t0 = Date.now();
      state = buildIndex(dir());
      console.log(`[recipe] ${state.found}/4 archives, ${state.index.size} forms indexed from ${dir()} in ${Date.now() - t0} ms`);
    }
    return state;
  };

  const handler = (req, res, next) => {
    const url = decodeURIComponent((req.url || '').split('?')[0]);
    let m;
    if ((m = url.match(/^\/recipe\/(pm\d{4}_\d\d_\d\d)\/manifest$/))) {
      const files = ensure().index.get(m[1]);
      if (!files) { res.statusCode = 404; return res.end(`no form ${m[1]} (archives in ${dir()}?)`); }
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ id: m[1], files: [...files.keys()].sort() }));
    }
    if ((m = url.match(/^\/recipe\/(pm\d{4}_\d\d_\d\d)\/file\/([\w.-]+)$/))) {
      const hit = ensure().index.get(m[1])?.get(m[2]);
      if (!hit) { res.statusCode = 404; return res.end(`no file ${m[2]}`); }
      try {
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.end(hit.zip.get(hit.entry));
      } catch (e) {
        res.statusCode = 500;
        return res.end(String(e && e.message));
      }
    }
    next();
  };

  return {
    name: 'recipe-assets',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
