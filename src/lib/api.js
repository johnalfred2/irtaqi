const LAYOUT_BASE = 'https://raw.githubusercontent.com/zonetecde/mushaf-layout/refs/heads/main/mushaf';
const QPC_FONT_BASE = 'https://static-cdn.tarteel.ai/qul/fonts/quran_fonts/v2/woff2';
const BASMALA = '\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u064e\u0651\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0640\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650';

export { BASMALA };

export async function fetchPageLayout(pageNumber) {
  const padded = String(pageNumber).padStart(3, '0');
  const url = `${LAYOUT_BASE}/page-${padded}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Page ${pageNumber} not found`);
  return await res.json();
}

export async function loadQPCFont(pageNumber) {
  const fontName = `QPC_p${pageNumber}`;
  const styleId = `font-${fontName}`;
  if (document.getElementById(styleId)) return fontName;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @font-face {
      font-family: '${fontName}';
      src: url(${QPC_FONT_BASE}/p${pageNumber}.woff2) format('woff2');
      font-display: swap;
    }
  `;
  document.head.appendChild(style);

  await document.fonts.load(`16px "${fontName}"`);
  return fontName;
}
