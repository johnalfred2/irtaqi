<script>
  import { fetchPageSVG, parsePageSVG } from '../lib/svgApi.js';

  let { pageNumber = 1, revealedUpto = -1, onLoaded = null } = $props();

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
    loadError = false;
    try {
      const svgText = await fetchPageSVG(num);
      if (loadingPage !== num) return;
      if (!svgContainer) return;
      const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
      doc.querySelectorAll('script, [onload], [onerror], [onclick], [onfocus], [onblur], [oninput], [onchange]').forEach(el => el.remove());
      wordIds = [];
      wordIndexMap = new Map();
      lastUpto = -2;
      svgContainer.innerHTML = new XMLSerializer().serializeToString(doc.documentElement);
      requestAnimationFrame(() => {
        cropToContent(svgContainer);
        fitSVG(svgContainer);
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
  }

  function cropToContent(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    const targets = container.querySelectorAll(
      '[id^="md-word-"], ' +
      '[id^="md-aya-mark-"], ' +
      '[data-type="surah-name"]'
    );
    if (targets.length === 0) return;

    let vx1 = Infinity, vy1 = Infinity, vx2 = -Infinity, vy2 = -Infinity;
    for (const el of targets) {
      const id = el.getAttribute('id') || '';
      if (id.startsWith('md-non-quranic-header') || id === 'md-non-quranic-page-number') continue;
      try {
        const bb = el.getBBox();
        vx1 = Math.min(vx1, bb.x);
        vy1 = Math.min(vy1, bb.y);
        vx2 = Math.max(vx2, bb.x + bb.width);
        vy2 = Math.max(vy2, bb.y + bb.height);
      } catch (e) { }
    }

    if (!isFinite(vx1)) return;
    const GAP = 4;
    svg.setAttribute('viewBox',
      `${vx1 - GAP} ${vy1 - GAP} ${vx2 - vx1 + GAP * 2} ${vy2 - vy1 + GAP * 2}`
    );
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
    const containerAspect = availW / availH;
    if (containerAspect > aspect) {
      const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
      if (isTouch) {
        const w = availW;
        const h = w / aspect;
        svg.style.width = `${w}px`;
        svg.style.height = `${h}px`;
      } else {
        let h = availH;
        let w = h * aspect;
        if (w > availW) {
          w = availW;
          h = w / aspect;
        }
        svg.style.width = `${w}px`;
        svg.style.height = `${h}px`;
      }
    } else {
      let h = availH;
      let w = h * aspect;
      if (w > availW) {
        w = availW;
        h = w / aspect;
      }
      svg.style.width = `${w}px`;
      svg.style.height = `${h}px`;
    }
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

  let lastUpto = -2;

  function applyReveal(upto) {
    if (!svgContainer || wordIds.length === 0 || upto === lastUpto) return;
    lastUpto = upto;
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
