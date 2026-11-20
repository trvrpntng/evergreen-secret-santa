import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from '../server.mjs';

async function startServer(context, databasePath = ':memory:') {
  const server = createServer({ databasePath });
  let closed = false;

  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(close);

  const origin = `http://127.0.0.1:${server.address().port}`;

  async function request(path, payload) {
    const options = payload === undefined ? undefined : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    const response = await fetch(`${origin}${path}`, options);
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }

  return { request, close };
}

function createDraw(request, names) {
  return request('/api/draws', { names });
}

function reveal(request, id, name) {
  return request(`/api/draws/${id}/reveal`, { name });
}

test('creates a private derangement and reveals each pairing exactly once', async (context) => {
  const { request } = await startServer(context);
  const names = ['Ava', 'Ben', 'Chen', 'Dev', 'Esme', 'Fern'];
  const created = await createDraw(request, names);
  assert.equal(created.status, 201);
  const { id } = created.body;
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.deepEqual(created.body, { id, count: names.length });

  const metadata = await request(`/api/draws/${id}`);
  assert.equal(metadata.status, 200);
  assert.deepEqual(metadata.body, { count: names.length });

  const recipients = [];
  for (const name of names) {
    const claim = await reveal(request, id, name);
    assert.equal(claim.status, 200);
    assert.deepEqual(Object.keys(claim.body), ['recipient']);
    assert.match(claim.headers.get('cache-control') ?? '', /\bno-store\b/i);
    assert.notEqual(claim.body.recipient, name);
    recipients.push(claim.body.recipient);

    const repeat = await reveal(request, id, name);
    assert.equal(repeat.status, 409);
    assert.equal(repeat.body.code, 'already_revealed');
    assert.ok(!Object.hasOwn(repeat.body, 'recipient'));
  }

  assert.deepEqual(recipients.sort(), [...names].sort());
  const refreshed = await request(`/api/draws/${id}`);
  assert.deepEqual(refreshed.body, { count: names.length });
});

test('validates unique participant names and matches without case or surrounding whitespace', async (context) => {
  const { request } = await startServer(context);

  for (const names of [['Ava', '  ava ', 'Ben'], ['Ava', 'Ben'], ['Ava', 'Ben', '  ']]) {
    const invalid = await createDraw(request, names);
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.error);
  }

  const created = await createDraw(request, ['  Ava ', 'Ben', 'Chen']);
  assert.equal(created.status, 201);
  const { id } = created.body;

  const unknownName = await reveal(request, id, 'Morgan');
  assert.equal(unknownName.status, 404);
  assert.equal(unknownName.body.code, 'name_not_found');
  assert.ok(!Object.hasOwn(unknownName.body, 'recipient'));

  const claim = await reveal(request, id, '  aVA ');
  assert.equal(claim.status, 200);
  assert.ok(['Ben', 'Chen'].includes(claim.body.recipient));
  assert.equal((await reveal(request, id, 'Ava')).status, 409);

  const unknownDraw = await request('/api/draws/invalid!id');
  assert.equal(unknownDraw.status, 404);
  const absentId = `${id[0] === 'a' ? 'b' : 'a'}${id.slice(1)}`;
  const missingDrawClaim = await reveal(request, absentId, 'Ava');
  assert.equal(missingDrawClaim.status, 404);
  assert.equal(missingDrawClaim.body.code, 'draw_not_found');
});

test('only one simultaneous request can redeem the same assignment', async (context) => {
  const { request } = await startServer(context);
  const created = await createDraw(request, ['Ava', 'Ben', 'Chen']);
  assert.equal(created.status, 201);

  const contenders = ['Ava', 'aVA', ' AVA ', 'ava', 'Ava', 'AVA'];
  const claims = await Promise.all(contenders.map((name) => reveal(request, created.body.id, name)));
  const successes = claims.filter(({ status }) => status === 200);
  assert.equal(successes.length, 1);
  assert.ok(['Ben', 'Chen'].includes(successes[0].body.recipient));
  for (const denied of claims.filter(({ status }) => status !== 200)) {
    assert.equal(denied.status, 409);
    assert.equal(denied.body.code, 'already_revealed');
    assert.ok(!Object.hasOwn(denied.body, 'recipient'));
  }
});

test('a new draw keeps its claims separate from earlier draws with the same people', async (context) => {
  const { request } = await startServer(context);
  const names = Array.from({ length: 35 }, (_, index) => `Santa ${index + 1}`);
  const first = await createDraw(request, names);
  const second = await createDraw(request, names);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.count, names.length);
  assert.notEqual(second.body.id, first.body.id);

  assert.equal((await reveal(request, first.body.id, names[0])).status, 200);
  assert.equal((await reveal(request, second.body.id, names[0])).status, 200);
  assert.equal((await reveal(request, first.body.id, names[0])).status, 409);
});

test('keeps assignments and consumed reveals when the server restarts', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'secret-santa-test-'));
  const databasePath = join(directory, 'draws.sqlite');

  let first;
  let second;
  try {
    first = await startServer(context, databasePath);
    const created = await createDraw(first.request, ['Ava', 'Ben', 'Chen']);
    assert.equal(created.status, 201);
    const { id } = created.body;
    const firstClaim = await reveal(first.request, id, 'Ava');
    assert.equal(firstClaim.status, 200);
    await first.close();

    second = await startServer(context, databasePath);
    const metadata = await second.request(`/api/draws/${id}`);
    assert.equal(metadata.status, 200);
    assert.deepEqual(metadata.body, { count: 3 });
    assert.equal((await reveal(second.request, id, 'Ava')).status, 409);

    const ben = await reveal(second.request, id, 'Ben');
    const chen = await reveal(second.request, id, 'Chen');
    assert.equal(ben.status, 200);
    assert.equal(chen.status, 200);
    assert.deepEqual([firstClaim.body.recipient, ben.body.recipient, chen.body.recipient].sort(), ['Ava', 'Ben', 'Chen']);
  } finally {
    await first?.close();
    await second?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
