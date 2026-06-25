import { BASMALA } from './api.js';

export function parsePageLayout(raw) {
  const lines = [];
  const allWords = [];
  let globalIndex = 0;

  for (const rawLine of raw.lines) {
    if (rawLine.type === 'text') {
      const words = rawLine.words.map((w) => {
        const lastColon = w.location.lastIndexOf(':');
        const ayahKey = w.location.substring(0, lastColon);
        const word = {
          text: w.word,
          qpcV2: w.qpcV2 || '',
          qpcV1: w.qpcV1 || '',
          ayahKey,
          index: globalIndex,
        };
        allWords.push(word);
        globalIndex++;
        return word;
      });
      lines.push({ type: 'text', words });
    } else if (rawLine.type === 'basmala') {
      lines.push({
        type: 'basmala',
        text: rawLine.text || BASMALA,
        qpcV2: rawLine.qpcV2 || '',
        qpcV1: rawLine.qpcV1 || '',
      });
    } else if (rawLine.type === 'surah-header') {
      lines.push({ type: 'surah-header', text: rawLine.text, surah: rawLine.surah });
    }
  }

  const ayat = [];
  let start = 0;
  for (let i = 1; i <= allWords.length; i++) {
    if (i === allWords.length || allWords[i].ayahKey !== allWords[i - 1].ayahKey) {
      ayat.push({
        key: allWords[start].ayahKey,
        startWord: start,
        endWord: i - 1,
      });
      start = i;
    }
  }

  return {
    number: raw.page,
    lines,
    totalWords: allWords.length,
    ayat,
  };
}

export function getNextAyahEnd(ayat, currentUpto) {
  for (const a of ayat) {
    if (currentUpto >= a.startWord && currentUpto < a.endWord) {
      return a.endWord;
    }
  }
  for (const a of ayat) {
    if (a.startWord > currentUpto) return a.endWord;
  }
  return currentUpto;
}

export function getPrevAyahStart(ayat, currentUpto) {
  for (let i = ayat.length - 1; i >= 0; i--) {
    if (ayat[i].startWord <= currentUpto && ayat[i].endWord >= currentUpto) {
      return Math.max(-1, ayat[i].startWord - 1);
    }
  }
  for (let i = ayat.length - 1; i >= 0; i--) {
    if (ayat[i].endWord < currentUpto) return Math.max(-1, ayat[i].startWord - 1);
  }
  return -1;
}
