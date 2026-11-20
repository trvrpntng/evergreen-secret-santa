import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { handleRequest } from '../app.mjs';

const tagUrl = 'https://www.googletagmanager.com/gtm.js?id=GTM-MGHMGP99';
const invitePath = '/draw/a1ba9f37-2ea7-4ca4-a422-ec1e2964c071';

test('serves the Google tag with a valid script hash on every page', async () => {
  for (const path of ['/', '/gift-ideas', invitePath]) {
    const url = new URL(path, 'https://example.test');
    const page = await handleRequest(new Request(url), null, (asset) => {
      return readFile(new URL(`../public${asset}`, import.meta.url));
    });
    const html = (await page.text()).replaceAll('\r\n', '\n');
    const policy = page.headers.get('content-security-policy');
    const [, bootstrap] = html.match(/<script>([\s\S]+?)<\/script>/) ?? [];

    assert.equal(page.status, 200);
    assert.equal(html.split(tagUrl).length, 2);
    assert.ok(bootstrap);
    assert.ok(policy.includes(`'sha256-${createHash('sha256').update(bootstrap).digest('base64')}'`));
    assert.ok(policy.includes('https://www.googletagmanager.com'));
    assert.ok(!policy.includes("'unsafe-inline'"));

    const browser = { location: url };
    browser.window = browser;
    runInNewContext(bootstrap, browser);
    const pageLocation = browser.dataLayer.find((entry) => entry[0] === 'set' && entry[1] === 'page_location');
    assert.equal(pageLocation?.[2], path === invitePath ? 'https://example.test/draw' : undefined);
    assert.equal(browser.dataLayer.at(-1)[0], 'js');
  }
});
