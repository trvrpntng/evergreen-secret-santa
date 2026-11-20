const drawIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const bodyLimit = 1024 * 1024;
const staticTypes = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/gift-ideas.html', 'text/html; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/gift-ideas.js', 'text/javascript; charset=utf-8'],
  ['/assets/evergreen-cabin.jpg', 'image/jpeg'],
]);
const giftCategories = ['cosy', 'food', 'games', 'books', 'desk', 'experiences'];

export const assetPaths = [...staticTypes.keys()];

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const missingDraw = () => problem(404, 'This draw could not be found. Check the invitation link.', 'draw_not_found');

function json(value, status = 200) {
  return Response.json(value, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store' } });
}

function problem(status, error, code) {
  return json(code ? { error, code } : { error }, status);
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return name.length <= 100 && !/\p{Cc}/u.test(name) ? name : '';
}

function nameKey(name) {
  return name.toLowerCase().normalize('NFKC');
}

function randomRecipients(names) {
  const random = new Uint32Array(128);
  const range = 2 ** 32;
  let offset = random.length;

  function randomIndex(bound) {
    const limit = range - (range % bound);
    let value;
    do {
      if (offset === random.length) {
        crypto.getRandomValues(random);
        offset = 0;
      }
      value = random[offset++];
    } while (value >= limit);
    return value % bound;
  }

  const recipients = [...names];
  // Rejection sampling keeps every valid permutation equally likely.
  do {
    for (let index = recipients.length - 1; index > 0; index--) {
      const other = randomIndex(index + 1);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
  } while (recipients.some((recipient, index) => recipient === names[index]));
  return recipients;
}

async function readJson(request) {
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > bodyLimit) return null;
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function createDraw(request, store) {
  const body = await readJson(request);
  if (!Array.isArray(body?.names) || body.names.length < 3) {
    return problem(400, 'Add at least three Santas before drawing names.');
  }

  const names = body.names.map(normalizeName);
  if (names.some((name) => !name)) {
    return problem(400, 'Enter a name of 100 characters or fewer for each Santa.');
  }
  const keys = names.map(nameKey);
  if (new Set(keys).size !== keys.length) {
    return problem(400, 'Give each Santa a unique name. Try an initial or nickname for matching names.');
  }

  const id = crypto.randomUUID();
  const recipients = randomRecipients(names);
  await store.create(id, keys.map((key, index) => [key, recipients[index]]));
  return json({ id, count: names.length }, 201);
}

async function reveal(request, store, id) {
  const body = await readJson(request);
  const name = normalizeName(body?.name);
  if (!name) return problem(400, 'Enter the name your organiser used.');

  const key = nameKey(name);
  const recipient = await store.claim(id, key);
  if (recipient !== undefined) return json({ recipient });
  if (await store.hasParticipant(id, key)) {
    return problem(409, 'This assignment has already been revealed.', 'already_revealed');
  }
  if (!await store.count(id)) return missingDraw();
  return problem(404, 'That name is not in this draw. Check the spelling with your organiser.', 'name_not_found');
}

async function handleApi(request, path, store) {
  if (path === '/api/draws') {
    return request.method === 'POST' ? createDraw(request, store) : problem(405, 'This request method is not supported.');
  }

  const match = /^\/api\/draws\/([^/]+)(\/reveal)?$/.exec(path);
  if (!match || !drawIdPattern.test(match[1])) return missingDraw();
  const [, id, revealPath] = match;
  if (revealPath && request.method === 'POST') return reveal(request, store, id);
  if (!revealPath && request.method === 'GET') {
    const count = await store.count(id);
    return count ? json({ count }) : missingDraw();
  }
  return problem(405, 'This request method is not supported.');
}

function affiliateLinks(setting) {
  if (typeof setting !== 'string' || setting.length === 0) return {};
  let urls;
  try {
    urls = JSON.parse(setting);
  } catch {
    return {};
  }
  if (urls === null || typeof urls !== 'object' || Array.isArray(urls)) return {};

  const links = {};
  for (const category of giftCategories) {
    if (!Object.hasOwn(urls, category) || typeof urls[category] !== 'string') continue;
    try {
      const url = new URL(urls[category]);
      if (url.protocol === 'https:' && !url.username && !url.password) links[category] = url.href;
    } catch {
      // A malformed URL should not stop the other categories from appearing.
    }
  }
  return links;
}

export async function handleRequest(request, store, readAsset, giftAffiliateLinks) {
  try {
    const path = new URL(request.url).pathname;
    if (path === '/api/gift-ideas') {
      return request.method === 'GET'
        ? json({ links: affiliateLinks(giftAffiliateLinks) })
        : problem(405, 'This request method is not supported.');
    }
    if (path.startsWith('/api/')) return await handleApi(request, path, store);

    let asset = path;
    if (path === '/' || /^\/draw(?:\/[^/]+)?\/?$/.test(path)) asset = '/index.html';
    if (path === '/gift-ideas' || path === '/gift-ideas/') asset = '/gift-ideas.html';
    if (!staticTypes.has(asset) || !['GET', 'HEAD'].includes(request.method)) {
      return new Response('Page not found', { status: 404, headers: securityHeaders });
    }
    const content = await readAsset(asset);
    if (!content) return new Response('Page not found', { status: 404, headers: securityHeaders });
    return new Response(request.method === 'HEAD' ? null : content, {
      headers: {
        ...securityHeaders,
        'Content-Type': staticTypes.get(asset),
        'Cache-Control': asset === '/index.html' ? 'no-store' : 'no-cache',
      },
    });
  } catch (error) {
    console.error('Request failed:', error.message);
    return problem(500, 'Something went wrong. Please try again.');
  }
}

export function createStore(execute) {
  return {
    async create(id, entries) {
      await execute(`INSERT INTO draw_assignments (draw_id, name_key, recipient)
        SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
      [id, JSON.stringify(entries)]);
    },
    async count(id) {
      const row = await execute('SELECT COUNT(*) AS count FROM draw_assignments WHERE draw_id = ?', [id]);
      return row.count;
    },
    async claim(id, key) {
      const row = await execute(`UPDATE draw_assignments SET revealed = 1
        WHERE draw_id = ? AND name_key = ? AND revealed = 0 RETURNING recipient`, [id, key]);
      return row?.recipient;
    },
    async hasParticipant(id, key) {
      const row = await execute('SELECT 1 FROM draw_assignments WHERE draw_id = ? AND name_key = ?', [id, key]);
      return Boolean(row);
    },
  };
}
