import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { assetPaths } from './app.mjs';

const output = new URL('./dist/server/', import.meta.url);
const application = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
const assets = await Promise.all(assetPaths.map(async (assetPath) => {
  const data = await readFile(new URL(`./public${assetPath}`, import.meta.url));
  return [assetPath, data.toString('base64')];
}));

// Sites deploys the Worker as a single module. Keep the editable assets separate in source.
const worker = `
const assets = new Map(${JSON.stringify(assets)});

export default {
  fetch(request, env) {
    const store = createStore((sql, parameters) => env.DB.prepare(sql).bind(...parameters).first());
    return handleRequest(request, store, (name) => {
      const asset = assets.get(name);
      return asset === undefined ? null : Uint8Array.from(atob(asset), (symbol) => symbol.charCodeAt(0));
    }, env.GIFT_AFFILIATE_LINKS);
  },
};
`;

await mkdir(output, { recursive: true });
await writeFile(new URL('index.js', output), `${application}\n${worker}`);
