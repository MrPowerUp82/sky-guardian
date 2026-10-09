// Service worker: makes the game playable offline.
//
//  - core files (HTML/JS/CSS/config/three.js/icons) are cached at install and
//    served network-first (3 s timeout), so edits show up online and the cache is
//    the fallback offline;
//  - the big .glb models are downloaded in the background (page asks for it) and
//    served cache-first. Each carries a content hash, so only changed ones reload.
//
// VERSION is stamped by tools/build-pwa.mjs (`npm run pwa`).
const VERSION = '1fae9837e6';
const CORE_CACHE = `sky-core-${VERSION}`;
const ASSET_CACHE = 'sky-assets';
const STATE_KEY = './__state__';
const NETWORK_TIMEOUT = 3000;

const loadManifest = async () => {
  try {
    const response = await fetch('./pwa-manifest.json', { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      const cache = await caches.open(ASSET_CACHE);
      await cache.put('./__manifest__', new Response(JSON.stringify(manifest)));
      return manifest;
    }
  } catch { /* offline: fall through to the stored copy */ }
  const stored = await (await caches.open(ASSET_CACHE)).match('./__manifest__');
  return stored ? stored.json() : null;
};

const readState = async () => {
  const hit = await (await caches.open(ASSET_CACHE)).match(STATE_KEY);
  return hit ? hit.json() : { hashes: {} };
};
const writeState = async state => (await caches.open(ASSET_CACHE)).put(STATE_KEY, new Response(JSON.stringify(state)));

async function broadcast(message) {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
}

// ---- install / activate ------------------------------------------------------------
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const manifest = await loadManifest();
    if (!manifest) throw new Error('pwa-manifest.json unavailable');
    const cache = await caches.open(CORE_CACHE);
    await Promise.all(manifest.core.map(url => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('sky-core-') && name !== CORE_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// ---- background model download ---------------------------------------------------------
let syncing = null;
function syncAssets() {
  if (syncing) return syncing;
  syncing = (async () => {
    const manifest = await loadManifest();
    if (!manifest) return;
    const cache = await caches.open(ASSET_CACHE);
    const state = await readState();
    const wanted = new Map(manifest.assets.map(a => [a.url, a]));
    const todo = manifest.assets.filter(a => state.hashes[a.url] !== a.hash);
    const total = todo.reduce((sum, a) => sum + a.size, 0);
    let done = 0;
    await broadcast({ type: 'offline-progress', done, total, files: todo.length });

    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const asset = queue.shift();
        const response = await fetch(asset.url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`${asset.url}: HTTP ${response.status}`);
        await cache.put(asset.url, response);
        state.hashes[asset.url] = asset.hash;
        done += asset.size;
        await broadcast({ type: 'offline-progress', done, total, files: queue.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    for (const url of Object.keys(state.hashes)) {
      if (!wanted.has(url)) { delete state.hashes[url]; await cache.delete(url); }
    }
    state.version = VERSION;
    await writeState(state);
    await broadcast({ type: 'offline-ready', version: VERSION });
  })().catch(error => broadcast({ type: 'offline-error', message: String(error?.message || error) }))
    .finally(() => { syncing = null; });
  return syncing;
}

async function reportStatus(client) {
  const [manifest, state] = [await loadManifest(), await readState()];
  const ready = !!manifest && manifest.assets.every(a => state.hashes[a.url] === a.hash);
  client.postMessage({ type: 'offline-status', ready, version: VERSION, bytes: manifest?.assetBytes || 0 });
}

self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'precache') event.waitUntil(syncAssets());
  else if (type === 'status') event.waitUntil(reportStatus(event.source));
  else if (type === 'skip-waiting') self.skipWaiting();
});

// ---- fetching -----------------------------------------------------------------------------
const isAsset = url => url.pathname.includes('/assets/') && url.pathname.endsWith('.glb');

async function cacheFirst(request) {
  const hit = await caches.match(request, { cacheName: ASSET_CACHE });
  return hit || fetch(request);
}

async function networkFirst(request, url) {
  // Query strings (?debug, ?touch=1, ?source=pwa) all share one cached page.
  const key = request.mode === 'navigate' ? new Request(url.origin + url.pathname) : request;
  const cache = await caches.open(CORE_CACHE);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT))
    ]);
  } catch {
    network.catch(() => {}); // keep refreshing the cache if the slow request finishes
    const cached = await cache.match(key) || (request.mode === 'navigate' && await cache.match('./index.html'));
    if (cached) return cached;
    return new Response('Sem conexão e sem cópia offline deste arquivo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;           // CDN mirrors etc.: not our business
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/pwa-manifest.json')) return;
  if (isAsset(url)) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request, url));
});
