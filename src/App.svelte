<script>
  import { onMount, onDestroy } from 'svelte';
  import MushafPage from './components/MushafPage.svelte';
  import PageNav from './components/PageNav.svelte';
  import DownloadScreen from './components/DownloadScreen.svelte';
  import { getNextAyahEnd, getPrevAyahStart } from './lib/layout.js';
  import { getSurahList } from './lib/surahs.js';
  import { checkDownloaded } from './lib/downloadManager.js';

  const TOTAL_PAGES = 604;
  const SWIPE_THRESHOLD = 50;
  const TAP_MAX_DIST = 10;
  const TAP_MAX_TIME = 300;
  const LONG_PRESS_TIME = 500;

  let downloadReady = $state(null);
  let activePage = $state(1);
  let activeLayout = $state(null);
  let activeRevealed = $state(-1);
  let eyeOpen = $state(false);
  let darkTheme = $state(true);
  let surahs = $state([]);
  let errorMsg = $state('');
  let loadingPage = $state(false);
  let showOverlay = $state(false);
  let pendingMode = 'restore';
  let isTouchDevice = $state(false);
  let navOverlayMode = $state(null);

  const pageStates = new Map();

  let activeJuz = $derived(Math.min(30, Math.floor((activePage - 1) / 20) + 1));

  let pageContainerEl = $state(null);
  let touchStart = null;
  let longPressTimer = null;

  let wakeLock = null;

  onMount(() => {
    window.addEventListener('keydown', handleKey);

    const STORAGE_VERSION = 'v2';
    if (localStorage.getItem('quran-storage-version') !== STORAGE_VERSION) {
      localStorage.removeItem('quran-last-page');
      localStorage.removeItem('quran-page-states');
      localStorage.setItem('quran-storage-version', STORAGE_VERSION);
    }

    const savedPage = parseInt(localStorage.getItem('quran-last-page'));
    if (savedPage >= 1 && savedPage <= TOTAL_PAGES) activePage = savedPage;

    try {
      const savedStates = localStorage.getItem('quran-page-states');
      if (savedStates) {
        const obj = JSON.parse(savedStates);
        for (const k of Object.keys(obj)) pageStates.set(parseInt(k), obj[k]);
      }
    } catch (e) { /* ignore corrupt storage */ }

    eyeOpen = localStorage.getItem('quran-eye-open') === 'true';
    darkTheme = localStorage.getItem('quran-dark-theme') !== 'false';
    document.documentElement.classList.toggle('light', !darkTheme);

    getSurahList().then((list) => { surahs = list; });
    loadingPage = true;
    acquireWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);

    isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;

    const isNative = typeof window.Capacitor?.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
    if (isNative) {
      checkDownloaded().then((ok) => { downloadReady = ok; });
    } else {
      downloadReady = true;
    }
  });

  function onDownloadComplete() {
    downloadReady = true;
  }

  function onPageLoaded(parsed, pageNum) {
    if (pageNum !== activePage) return;
    activeLayout = parsed;
    if (pendingMode === 'fresh') {
      activeRevealed = -1;
    } else if (pendingMode === 'full') {
      activeRevealed = parsed.totalWords - 1;
    } else {
      activeRevealed = pageStates.get(activePage) ?? -1;
    }
    if (eyeOpen) activeRevealed = parsed.totalWords - 1;
    loadingPage = false;
  }

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    document.removeEventListener('visibilitychange', handleVisibility);
    releaseWakeLock();
    flushState();
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
  function flushState() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    localStorage.setItem('quran-last-page', String(activePage));
    localStorage.setItem('quran-eye-open', String(eyeOpen));
    localStorage.setItem('quran-dark-theme', String(darkTheme));
    const obj = {};
    for (const [k, v] of pageStates) obj[k] = v;
    localStorage.setItem('quran-page-states', JSON.stringify(obj));
  }
  function persistState() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushState, 300);
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
    } else if (e.key === 'h') {
      e.preventDefault();
      eyeOpen = false;
      activeRevealed = -1;
      persistState();
    } else if (e.key === 's') {
      e.preventDefault();
      eyeOpen = true;
      if (activeLayout) {
        activeRevealed = activeLayout.totalWords - 1;
        persistState();
      }
    } else if (e.key === 't') {
      e.preventDefault();
      darkTheme = !darkTheme;
      document.documentElement.classList.toggle('light', !darkTheme);
      persistState();
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
    if (e.target.closest('[data-nav-click]')) return;
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
    if (!eyeOpen) pageStates.set(activePage, activeRevealed);
    persistState();
  }

  function revealNextAyah() {
    if (!activeLayout) return;
    const next = getNextAyahEnd(activeLayout.ayat, activeRevealed);
    if (next > activeRevealed) {
      activeRevealed = next;
      if (!eyeOpen) pageStates.set(activePage, activeRevealed);
      persistState();
    } else if (activePage < TOTAL_PAGES) {
      goToPage(activePage + 1, 'fresh');
    }
  }

  function hidePrevWord() {
    if (activeRevealed >= 0) {
      activeRevealed--;
      if (!eyeOpen) pageStates.set(activePage, activeRevealed);
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
    if (!eyeOpen) pageStates.set(activePage, activeRevealed);
    persistState();
  }

  function onNavigateClick(mode) {
    navOverlayMode = mode;
  }

  function closeNavOverlay() {
    navOverlayMode = null;
  }

  function selectNavOption(mode, value) {
    if (mode === 'surah') {
      const s = surahs.find((s) => s.number === value);
      if (s && s.startPage) goToPage(s.startPage);
    } else if (mode === 'juz') {
      goToPage((value - 1) * 20 + 1);
    } else if (mode === 'page') {
      goToPage(value);
    }
    navOverlayMode = null;
  }

  function handleToggleAll() {
    if (!activeLayout) return;
    eyeOpen = !eyeOpen;
    if (eyeOpen) {
      activeRevealed = activeLayout.totalWords - 1;
    } else {
      activeRevealed = -1;
    }
    persistState();
  }

  function handleToggleTheme() {
    darkTheme = !darkTheme;
    document.documentElement.classList.toggle('light', !darkTheme);
    persistState();
  }

  function goToPage(page, mode = 'restore') {
    let target = Math.max(1, Math.min(TOTAL_PAGES, page));
    if (target === activePage) return;
    if (activeLayout && !eyeOpen) {
      pageStates.set(activePage, activeRevealed);
      persistState();
    }
    pendingMode = mode;
    activeLayout = null;
    loadingPage = true;
    activePage = target;
  }
</script>

{#if downloadReady === false}
  <DownloadScreen onComplete={onDownloadComplete} />
{:else if downloadReady === true}
  {#if errorMsg}
    <div class="global-error">{errorMsg}</div>
  {/if}

  <div
    class="page-container"
    bind:this={pageContainerEl}
    role="application"
    aria-label="Quran page. Tap left side to reveal next word, right side to hide. Swipe to change page."
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <MushafPage pageNumber={activePage} revealedUpto={activeRevealed} onLoaded={onPageLoaded} enableNavClicks={isTouchDevice} onNavigateClick={onNavigateClick} />
  </div>

  {#if !isTouchDevice}
    <PageNav
      currentPage={activePage}
      totalPages={TOTAL_PAGES}
      {surahs}
      onPageChange={goToPage}
      {eyeOpen}
      {darkTheme}
      onToggleAll={handleToggleAll}
      onToggleTheme={handleToggleTheme}
    />

    <div class="shortcuts-help">
      <span><kbd>Space</kbd>/<kbd>&larr;</kbd> next word</span>
      <span><kbd>Shift</kbd>+<kbd>Space</kbd> next ayah</span>
      <span><kbd>Backspace</kbd>/<kbd>&rarr;</kbd> prev word</span>
      <span><kbd>h</kbd> hide all &middot; <kbd>s</kbd> show all</span>
      <span><kbd>n</kbd>/<kbd>p</kbd> next/prev page</span>
      <span><kbd>?</kbd> all shortcuts</span>
    </div>
  {/if}

  {#if isTouchDevice}
    <div class="floating-toggles">
      <button class="float-btn" onclick={handleToggleAll} title={eyeOpen ? 'Hide all' : 'Show all'}>
        {#if eyeOpen}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
          </svg>
        {/if}
      </button>
      <button class="float-btn" onclick={handleToggleTheme} title={darkTheme ? 'Light mode' : 'Dark mode'}>
        {#if darkTheme}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {/if}
      </button>
    </div>
  {/if}

  <div class="mobile-touch-hint">
    Tap left/right to step &middot; long-press for ayah &middot; swipe to change page
  </div>

  {#if navOverlayMode}
    <div class="overlay-backdrop" onclick={closeNavOverlay} onkeydown={(e) => e.key === 'Escape' && closeNavOverlay()} role="presentation">
      <div class="overlay-card overlay-card-nav" tabindex="0" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>
          {#if navOverlayMode === 'surah'}Select Surah
          {:else if navOverlayMode === 'juz'}Select Juz
          {:else}Select Page
          {/if}
        </h2>
        <div class="nav-overlay-list">
          {#if navOverlayMode === 'surah'}
            {#each surahs as s}
              <button class="nav-overlay-item" onclick={() => selectNavOption('surah', s.number)}>
                {s.number}. {s.name}
              </button>
            {/each}
          {:else if navOverlayMode === 'juz'}
            {#each Array.from({ length: 30 }, (_, i) => i + 1) as juz}
              <button class="nav-overlay-item" onclick={() => selectNavOption('juz', juz)}>
                Juz {juz}
              </button>
            {/each}
          {:else}
            {#each Array.from({ length: 604 }, (_, i) => i + 1) as p}
              <button class="nav-overlay-item" onclick={() => selectNavOption('page', p)}>
                Page {p}
              </button>
            {/each}
          {/if}
        </div>
        <button class="overlay-close" onclick={closeNavOverlay}>Close</button>
      </div>
    </div>
  {/if}

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
            <tr><td><kbd>h</kbd></td><td>Hide all ayahs</td></tr>
            <tr><td><kbd>s</kbd></td><td>Show all ayahs</td></tr>
            <tr><td><kbd>t</kbd></td><td>Toggle dark/light theme</td></tr>
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
{/if}

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px;
    flex: 1;
    overflow: hidden;
    min-height: 0;
    touch-action: pan-y;
  }

  .global-error {
    background: #ff4444;
    color: #fff;
    padding: 12px 24px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
  }
</style>
