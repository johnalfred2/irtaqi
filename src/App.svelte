<script>
  import { onMount, onDestroy } from 'svelte';
  import MushafPage from './components/MushafPage.svelte';
  import Header from './components/Header.svelte';
  import PageNav from './components/PageNav.svelte';
  import { fetchPageLayout } from './lib/api.js';
  import { parsePageLayout, getNextAyahEnd, getPrevAyahStart } from './lib/layout.js';
  import { getSurahList, findSurahByPage } from './lib/surahs.js';

  const TOTAL_PAGES = 604;
  const SWIPE_THRESHOLD = 50;
  const TAP_MAX_DIST = 10;
  const TAP_MAX_TIME = 300;
  const LONG_PRESS_TIME = 500;

  let activePage = $state(1);
  let activeLayout = $state(null);
  let activeRevealed = $state(-1);
  let surahs = $state([]);
  let errorMsg = $state('');
  let loadingPage = $state(false);
  let showOverlay = $state(false);

  const pageStates = new Map();

  let currentSurah = $derived(findSurahByPage(activePage));
  let activeJuz = $derived(Math.floor((activePage - 1) / 20) + 1);

  let pageContainerEl = $state(null);
  let touchStart = null;
  let longPressTimer = null;

  let wakeLock = null;

  onMount(() => {
    window.addEventListener('keydown', handleKey);

    const STORAGE_VERSION = 'v1';
    if (localStorage.getItem('quran-storage-version') !== STORAGE_VERSION) {
      localStorage.removeItem('quran-last-page');
      localStorage.removeItem('quran-page-states');
      localStorage.setItem('quran-storage-version', STORAGE_VERSION);
    }

    const savedPage = parseInt(localStorage.getItem('quran-last-page'));
    const startPage = savedPage >= 1 && savedPage <= TOTAL_PAGES ? savedPage : 1;

    try {
      const savedStates = localStorage.getItem('quran-page-states');
      if (savedStates) {
        const obj = JSON.parse(savedStates);
        for (const k of Object.keys(obj)) pageStates.set(parseInt(k), obj[k]);
      }
    } catch (e) { /* ignore corrupt storage */ }

    getSurahList().then((list) => { surahs = list; });
    loadActivePage(startPage);
    acquireWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    document.removeEventListener('visibilitychange', handleVisibility);
    releaseWakeLock();
    persistState();
  });

  async function acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
    }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible') acquireWakeLock();
  }

  let persistTimer = null;
  function persistState() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      localStorage.setItem('quran-last-page', String(activePage));
      const obj = {};
      for (const [k, v] of pageStates) obj[k] = v;
      localStorage.setItem('quran-page-states', JSON.stringify(obj));
    }, 300);
  }

  async function loadActivePage(num, mode = 'restore') {
    loadingPage = true;
    errorMsg = '';
    try {
      const raw = await fetchPageLayout(num);
      activeLayout = parsePageLayout(raw);
      if (mode === 'fresh') {
        activeRevealed = -1;
      } else if (mode === 'full') {
        activeRevealed = activeLayout.totalWords - 1;
      } else {
        activeRevealed = pageStates.get(num) ?? -1;
      }
    } catch (e) {
      errorMsg = `Failed to load page ${num}`;
    }
    loadingPage = false;
  }

  function handleKey(e) {
    if (loadingPage) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const shift = e.shiftKey;

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      showOverlay = !showOverlay;
    } else if (e.key === 'Escape') {
      showOverlay = false;
    } else if (e.key === ' ' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (shift) revealNextAyah(); else revealNextWord();
    } else if (e.key === 'Backspace' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (shift) hidePrevAyah(); else hidePrevWord();
    } else if (e.key === 'n' || e.key === 'PageDown') {
      e.preventDefault();
      goToPage(activePage + 1);
    } else if (e.key === 'p' || e.key === 'PageUp') {
      e.preventDefault();
      goToPage(Math.max(1, activePage - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      goToPage(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      goToPage(TOTAL_PAGES);
    }
  }

  function onTouchStart(e) {
    if (loadingPage) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || e.target.closest('button')) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now(), target: e.target };
    longPressTimer = setTimeout(() => {
      if (touchStart && !touchStart.moved) {
        const half = window.innerWidth / 2;
        if (touchStart.x < half) revealNextAyah();
        else hidePrevAyah();
        touchStart.fired = true;
        if (navigator.vibrate) navigator.vibrate(15);
      }
    }, LONG_PRESS_TIME);
  }

  function onTouchMove(e) {
    if (!touchStart) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) > TAP_MAX_DIST || Math.abs(dy) > TAP_MAX_DIST) {
      touchStart.moved = true;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }
  }

  function onTouchEnd(e) {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const elapsed = Date.now() - touchStart.time;

    if (touchStart.fired) {
      touchStart = null;
      return;
    }

    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) goToPage(activePage + 1);
      else goToPage(Math.max(1, activePage - 1));
    } else if (!touchStart.moved && elapsed < TAP_MAX_TIME) {
      const half = window.innerWidth / 2;
      if (touchStart.x < half) revealNextWord();
      else hidePrevWord();
      if (navigator.vibrate) navigator.vibrate(10);
    }
    touchStart = null;
  }

  function revealNextWord() {
    if (!activeLayout) return;
    if (activeRevealed >= activeLayout.totalWords - 1) {
      if (activePage < TOTAL_PAGES) goToPage(activePage + 1, 'fresh');
      return;
    }
    activeRevealed++;
    persistState();
  }

  function revealNextAyah() {
    if (!activeLayout) return;
    const next = getNextAyahEnd(activeLayout.ayat, activeRevealed);
    if (next > activeRevealed) {
      activeRevealed = next;
      persistState();
    } else if (activePage < TOTAL_PAGES) {
      goToPage(activePage + 1, 'fresh');
    }
  }

  function hidePrevWord() {
    if (activeRevealed >= 0) {
      activeRevealed--;
      persistState();
    } else if (activePage > 1) {
      goToPage(activePage - 1, 'full');
    }
  }

  function hidePrevAyah() {
    if (!activeLayout) return;
    if (activeRevealed < 0) {
      if (activePage > 1) goToPage(activePage - 1, 'full');
      return;
    }
    activeRevealed = getPrevAyahStart(activeLayout.ayat, activeRevealed);
    persistState();
  }

  function goToPage(page, mode = 'restore') {
    let target = Math.max(1, Math.min(TOTAL_PAGES, page));
    if (activeLayout) {
      pageStates.set(activePage, activeRevealed);
      persistState();
    }
    activePage = target;
    loadActivePage(target, mode);
  }
</script>

{#if errorMsg}
  <div class="global-error">{errorMsg}</div>
{/if}

<Header
  surahName={currentSurah?.name || ''}
  surahArabic={currentSurah?.arabic || ''}
  pageNumber={activePage}
  totalPages={TOTAL_PAGES}
  juz={activeJuz}
/>

<div
  class="page-container"
  bind:this={pageContainerEl}
  role="application"
  aria-label="Quran page. Tap left side to reveal next word, right side to hide. Swipe to change page."
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
>
  <MushafPage pageNumber={activePage} revealedUpto={activeRevealed} />
</div>

<PageNav
  currentPage={activePage}
  totalPages={TOTAL_PAGES}
  {surahs}
  onPageChange={goToPage}
/>

<div class="shortcuts-help">
  <span><kbd>Space</kbd>/<kbd>&larr;</kbd> next word</span>
  <span><kbd>Shift</kbd>+<kbd>Space</kbd> next ayah</span>
  <span><kbd>Backspace</kbd>/<kbd>&rarr;</kbd> prev word</span>
  <span><kbd>n</kbd>/<kbd>p</kbd> next/prev page</span>
  <span><kbd>?</kbd> all shortcuts</span>
</div>

<div class="mobile-touch-hint">
  Tap left/right to step &middot; long-press for ayah &middot; swipe to change page
</div>

{#if showOverlay}
  <div class="overlay-backdrop" onclick={() => (showOverlay = false)} onkeydown={(e) => e.key === 'Escape' && (showOverlay = false)} role="presentation">
    <div class="overlay-card" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <h2>Keyboard Shortcuts</h2>
      <table class="shortcut-table">
        <tbody>
          <tr><td><kbd>Space</kbd> / <kbd>&larr;</kbd></td><td>Next word</td></tr>
          <tr><td><kbd>Shift</kbd> + <kbd>Space</kbd> / <kbd>Shift</kbd> + <kbd>&larr;</kbd></td><td>Next ayah</td></tr>
          <tr><td><kbd>Backspace</kbd> / <kbd>&rarr;</kbd></td><td>Previous word</td></tr>
          <tr><td><kbd>Shift</kbd> + <kbd>&rarr;</kbd></td><td>Previous ayah</td></tr>
          <tr><td><kbd>n</kbd> / <kbd>PgDn</kbd></td><td>Next page</td></tr>
          <tr><td><kbd>p</kbd> / <kbd>PgUp</kbd></td><td>Previous page</td></tr>
          <tr><td><kbd>Home</kbd></td><td>First page</td></tr>
          <tr><td><kbd>End</kbd></td><td>Last page</td></tr>
          <tr><td><kbd>?</kbd></td><td>Toggle this overlay</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close overlay</td></tr>
        </tbody>
      </table>
      <p class="overlay-touch-note">On touch devices: tap left/right side to step, long-press for ayah, swipe horizontally to change page.</p>
      <button class="overlay-close" onclick={() => (showOverlay = false)}>Close</button>
    </div>
  </div>
{/if}

<style>
  .global-error {
    background: #c0392b;
    color: white;
    padding: 12px 24px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    flex: 1;
    overflow-y: auto;
    touch-action: pan-y;
  }
</style>
