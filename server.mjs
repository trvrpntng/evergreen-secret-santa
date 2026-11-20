import { mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore, handleRequest } from './app.mjs';

const defaultDatabase = fileURLToPath(new URL('./data/draws.sqlite', import.meta.url));
const migration = readFileSync(new URL('./drizzle/0000_draw_assignments.sql', import.meta.url), 'utf8');

async function readAsset(asset) {
  try {
    return await readFile(new URL(`./public${asset}`, import.meta.url));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

export function createServer({ databasePath = defaultDatabase, giftAffiliateLinks = process.env.GIFT_AFFILIATE_LINKS } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec(migration);
  const store = createStore((sql, parameters) => database.prepare(sql).get(...parameters));

  const server = createHttpServer(async (incoming, outgoing) => {
    try {
      const options = { method: incoming.method, headers: incoming.headers };
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        options.body = Readable.toWeb(incoming);
        options.duplex = 'half';
      }
      const request = new Request(`http://localhost${incoming.url}`, options);
      const response = await handleRequest(request, store, readAsset, giftAffiliateLinks);
      const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(body);
    } catch {
      outgoing.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      outgoing.end('Invalid request');
    }
  });
  server.once('close', () => database.close());
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createServer({ databasePath: process.env.DATABASE_PATH });
  server.listen(port, host, () => {
    console.log(`Evergreen Secret Santa is running at http://${host}:${server.address().port}`);
  });
}
