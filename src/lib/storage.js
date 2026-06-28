const CACHE_NAME = 'quran-pages';

function storageKey(num) {
  return new Request(`/quran-pages/${String(num).padStart(3, '0')}`);
}

export async function savePageSVG(num, text) {
  const cache = await caches.open(CACHE_NAME);
  const key = storageKey(num);
  await cache.put(key, new Response(text, {
    headers: { 'Content-Type': 'image/svg+xml' },
  }));
}

export async function getPageSVG(num) {
  const cache = await caches.open(CACHE_NAME);
  const key = storageKey(num);
  const res = await cache.match(key);
  if (!res) return null;
  return await res.text();
}

export async function removePageSVG(num) {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(storageKey(num));
}

export async function clearAllPages() {
  await caches.delete(CACHE_NAME);
}

export async function getStoredPageCount() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  return keys.length;
}
