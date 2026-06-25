import { getPageSVG, savePageSVG } from './storage.js';

const SVG_BASE = 'https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01';

export async function fetchPageSVG(pageNumber) {
  const padded = String(pageNumber).padStart(3, '0');

  const local = await getPageSVG(pageNumber);
  if (local) return local;

  const url = `${SVG_BASE}/${padded}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Page ${pageNumber} SVG not found`);
  const text = await res.text();

  try {
    await savePageSVG(pageNumber, text);
  } catch (e) { /* cache save is best-effort */ }

  return text;
}

export function isDecorative(type, hafs) {
  if (type !== 'text') return true;
  return hafs.length === 1 && /[\u06D6-\u06ED]/.test(hafs);
}

export function parsePageSVG(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  const wordGroups = doc.querySelectorAll('[id^="md-word-"]');
  const wordIds = [];
  const wordIndexMap = new Map();
  const realWords = [];
  let globalIndex = -1;
  let lastRealAyahKey = null;
  const pendingDecorative = [];

  for (const wg of wordGroups) {
    const id = wg.getAttribute('id');
    const type = wg.getAttribute('data-type');
    const hafs = (wg.getAttribute('data-hafs') || '').trim();
    const surah = wg.getAttribute('data-surah');
    const aya = wg.getAttribute('data-aya');
    const ayahKey = surah && aya ? `${parseInt(surah)}:${parseInt(aya)}` : null;

    wordIds.push(id);

    if (isDecorative(type, hafs)) {
      if (lastRealAyahKey === null || (ayahKey && ayahKey !== lastRealAyahKey)) {
        pendingDecorative.push(id);
      } else {
        if (globalIndex < 0) globalIndex = 0;
        wordIndexMap.set(id, globalIndex);
      }
    } else {
      globalIndex++;
      wordIndexMap.set(id, globalIndex);
      for (const pid of pendingDecorative) wordIndexMap.set(pid, globalIndex);
      pendingDecorative.length = 0;
      lastRealAyahKey = ayahKey;
      realWords.push({ elementId: id, ayahKey, index: globalIndex });
    }
  }

  if (pendingDecorative.length > 0 && globalIndex >= 0) {
    for (const pid of pendingDecorative) wordIndexMap.set(pid, globalIndex);
  }

  const maxIndex = Math.max(-1, ...wordIndexMap.values());
  const totalWords = maxIndex + 1;

  const ayat = [];
  if (realWords.length > 0) {
    let start = 0;
    for (let i = 1; i <= realWords.length; i++) {
      if (i === realWords.length || realWords[i].ayahKey !== realWords[i - 1].ayahKey) {
        ayat.push({
          key: realWords[start].ayahKey,
          startWord: realWords[start].index,
          endWord: realWords[i - 1].index,
        });
        start = i;
      }
    }
  }

  return {
    totalWords,
    ayat,
    wordIds,
    wordIndexMap,
  };
}
