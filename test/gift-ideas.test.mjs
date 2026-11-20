import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleRequest } from '../app.mjs';

function giftRequest(path, settings) {
  const readAsset = (asset) => readFile(new URL(`../public${asset}`, import.meta.url));
  return handleRequest(new Request(`https://example.test${path}`), null, readAsset, settings);
}

test('serves gift suggestions without needing a draw or affiliate configuration', async () => {
  const page = await giftRequest('/gift-ideas/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await page.text(), /A cosy night in/);
  assert.deepEqual(await (await giftRequest('/api/gift-ideas')).json(), { links: {} });
  assert.deepEqual(await (await giftRequest('/api/gift-ideas', '{invalid')).json(), { links: {} });
});

test('exposes only supported categories with HTTPS affiliate destinations', async () => {
  const response = await giftRequest('/api/gift-ideas', JSON.stringify({
    cosy: 'https://example.test/shop?tag=example',
    food: 'javascript:void(0)',
    games: 'http://example.test',
    books: 'https://user:password@example.test',
    desk: '/items',
    experiences: 'https://example.test/workshops',
    extra: 'https://example.test/extra',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    links: {
      cosy: 'https://example.test/shop?tag=example',
      experiences: 'https://example.test/workshops',
    },
  });
});
