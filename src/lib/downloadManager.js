import { savePageSVG, getStoredPageCount, clearAllPages } from './storage.js';

const TOTAL_PAGES = 604;
const SVG_BASE = 'https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01';
const PARALLEL = 6;

export async function checkDownloaded() {
  const count = await getStoredPageCount();
  return count >= TOTAL_PAGES;
}

export async function startDownload(onProgress, onError) {
  await clearAllPages();
  let completed = 0;

  function report() {
    onProgress(completed, TOTAL_PAGES);
  }

  const queue = [];
  for (let i = 1; i <= TOTAL_PAGES; i++) queue.push(i);

  const retries = new Map();
  const MAX_RETRIES = 3;
  let fatalCount = 0;

  async function worker() {
    while (queue.length > 0) {
      const num = queue.shift();
      const padded = String(num).padStart(3, '0');
      const url = `${SVG_BASE}/${padded}.svg`;

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes('<svg')) throw new Error('Not an SVG');
        await savePageSVG(num, text);
        completed++;
        report();
      } catch (err) {
        const attempt = (retries.get(num) || 0) + 1;
        if (attempt <= MAX_RETRIES) {
          retries.set(num, attempt);
          queue.push(num);
        } else {
          fatalCount++;
          if (onError) onError(num, `Failed after ${MAX_RETRIES} attempts: ${err.message}`);
        }
      }
    }
  }

  const workers = Array.from({ length: PARALLEL }, () => worker());
  await Promise.all(workers);

  if (fatalCount > 0) {
    throw new Error(`Failed to download ${fatalCount} page(s)`);
  }
}
