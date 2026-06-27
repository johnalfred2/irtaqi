<script>
  import { fetchPageSVG, parsePageSVG } from '../lib/svgApi.js';

  let { pageNumber = 1, revealedUpto = -1, onLoaded = null, enableNavClicks = false, onNavigateClick = null } = $props();

  let svgContainer = $state(null);
  let wordIds = $state([]);
  let wordIndexMap = $state(new Map());
  let isLoading = $state(false);
  let loadError = $state(false);

  let resizeObserver = null;
  let loadingPage = 0;

  $effect(() => {
    loadPage(pageNumber);
  });

  $effect(() => {
    applyReveal(revealedUpto);
  });

  async function loadPage(num) {
    loadingPage = num;
    cleanupObserver();
    isLoading = true;
    loadError = false;
    wordIds = [];
    wordIndexMap = new Map();
    try {
      const svgText = await fetchPageSVG(num);
      if (loadingPage !== num) return;
      if (!svgContainer) return;
      svgContainer.innerHTML = svgText;
      requestAnimationFrame(() => {
        cropToContent(svgContainer);
        fitSVG(svgContainer);
        if (enableNavClicks) attachNavClicks();
      });
      setupObserver();
      const parsed = parsePageSVG(svgText);
      wordIndexMap = parsed.wordIndexMap;
      wordIds = parsed.wordIds;
      if (onLoaded) onLoaded(parsed, num);
      applyReveal(revealedUpto);
    } catch (e) {
      console.error('Failed to load SVG page', num, e);
      loadError = true;
    }
    isLoading = false;
  }

  function cropToContent(container) {
    const svg = container.querySelector('svg');
    const inner = container.querySelector('#md-page-inner');
    if (!svg || !inner) return;
    const rect = inner.getAttribute('data-rect');
    if (!rect) return;
    const [x1, y1, x2, y2] = rect.split(',').map(Number);
    if ([x1, y1, x2, y2].some(isNaN)) return;

    let vx1 = x1, vy1 = y1, vx2 = x2, vy2 = y2;
    const outer = container.querySelector('#md-page-outer');
    if (outer) {
      for (const child of outer.children) {
        if (child.id.includes('margin')) continue;
        try {
          const bb = child.getBBox();
          vx1 = Math.min(vx1, bb.x);
          vy1 = Math.min(vy1, bb.y);
          vx2 = Math.max(vx2, bb.x + bb.width);
          vy2 = Math.max(vy2, bb.y + bb.height);
        } catch (e) { /* element not renderable */ }
      }
    }
    svg.setAttribute('viewBox', `${vx1} ${vy1} ${vx2 - vx1} ${vy2 - vy1}`);
  }

  function getSVGAspect(svg) {
    const vb = svg.getAttribute('viewBox');
    if (!vb) return 1;
    const [,, w, h] = vb.split(/\s+/).map(Number);
    return w / h;
  }

  function fitSVG(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;
    const parent = container.parentElement;
    if (!parent) return;
    const aspect = getSVGAspect(svg);
    const availH = parent.clientHeight;
    const availW = parent.clientWidth;
    let h = availH;
    let w = h * aspect;
    if (w > availW) {
      w = availW;
      h = w / aspect;
    }
    svg.style.width = `${w}px`;
    svg.style.height = `${h}px`;
    svg.style.display = 'block';
  }

  function setupObserver() {
    cleanupObserver();
    const el = svgContainer?.parentElement;
    if (!el) return;
    resizeObserver = new ResizeObserver(() => {
      fitSVG(svgContainer);
    });
    resizeObserver.observe(el);
  }

  function cleanupObserver() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  function attachNavClicks() {
    if (!svgContainer) return;
    const items = [
      { id: '#md-non-quranic-header-surah-name', mode: 'surah' },
      { id: '#md-non-quranic-header-juz-name', mode: 'juz' },
      { id: '#md-non-quranic-page-number', mode: 'page' },
    ];
    const ns = 'http://www.w3.org/2000/svg';
    for (const { id, mode } of items) {
      const el = svgContainer.querySelector(id);
      if (el) {
        const bbox = el.getBBox();
        const padH = 24;
        const [padTop, padBottom] = mode === 'page' ? [16, 32] : [32, 16];
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', bbox.x - padH);
        rect.setAttribute('y', bbox.y - padTop);
        rect.setAttribute('width', bbox.width + padH * 2);
        rect.setAttribute('height', bbox.height + padTop + padBottom);
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('pointer-events', 'fill');
        rect.setAttribute('data-nav-click', 'true');
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', (e) => {
          e.stopPropagation();
          onNavigateClick?.(mode);
        });
        el.parentNode.insertBefore(rect, el.nextSibling);
      }
    }
  }

  function applyReveal(upto) {
    if (!svgContainer || wordIds.length === 0) return;
    for (const id of wordIds) {
      const el = svgContainer.querySelector(`#${CSS.escape(id)}`);
      if (!el) continue;
      const idx = wordIndexMap.get(id);
      el.style.opacity = idx <= upto ? '1' : '0';
    }
  }
</script>

<div class="mushaf-page" class:loading={isLoading}>
  {#if isLoading}
    <div class="page-loading">Loading page {pageNumber}...</div>
  {:else if loadError}
    <div class="page-error">Failed to load page {pageNumber}</div>
  {/if}
  <div class="svg-container" bind:this={svgContainer}></div>
</div>
