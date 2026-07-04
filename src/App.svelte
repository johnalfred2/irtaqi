<script>
  import { onMount, onDestroy } from 'svelte';
  import MushafPage from './components/MushafPage.svelte';
  import DownloadScreen from './components/DownloadScreen.svelte';
  import { getNextAyahEnd, getPrevAyahStart, fetchPageSVG } from './lib/svgApi.js';
  import { getSurahList, findSurahByPage } from './lib/surahs.js';
  import { checkDownloaded, startDownload } from './lib/downloadManager.js';
  import { clearAllPages, getStoredPageCount } from './lib/storage.js';
  import { TOTAL_PAGES } from './lib/constants.js';
  import { LANGUAGES, getTranslations } from './lib/i18n.js';
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
  let shortcutOverlayEl = $state(null);
  let showNavMenu = $state(false);
  let targetPage = $state(1);
  let showSettings = $state(false);
  let deferredPrompt = $state(null);
  let showInstallBanner = $state(false);
  let showUpdateBanner = $state(false);
  let isDownloading = $state(false);
  let downloadProgress = $state(0);
  let pagesDownloaded = $state(0);
  let isDownloaded = $derived(pagesDownloaded >= TOTAL_PAGES);
  let lang = $state('en');
  let t = $derived(getTranslations(lang));

  let menuSurah = $derived(findSurahByPage(targetPage).number);
  let menuJuz = $derived(Math.min(30, Math.floor((targetPage - 1) / 20) + 1));
  let menuPage = $derived(targetPage);

  $effect(() => {
    if (showOverlay && shortcutOverlayEl) {
      shortcutOverlayEl.focus();
    }
  });

  $effect(() => {
    const dir = LANGUAGES.find(l => l.code === lang)?.dir || 'ltr';
    document.documentElement.setAttribute('dir', dir);
  });

  const pageStates = new Map();

  let activeJuz = $derived(Math.min(30, Math.floor((activePage - 1) / 20) + 1));
  let currentSurah = $derived(findSurahByPage(activePage));

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
    const savedLang = localStorage.getItem('quran-lang');
    if (savedLang) lang = savedLang;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', darkTheme ? '#000000' : '#f5f5f5');

    getSurahList().then((list) => { surahs = list; });
    loadingPage = true;
    acquireWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);

    isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches || 'ontouchstart' in window;

    document.documentElement.setAttribute('dir', 'ltr');

    const isNative = typeof window.Capacitor?.isNativePlatform === 'function' && window.Capacitor.isNativePlatform();
    if (isNative) {
      checkDownloaded().then((ok) => { downloadReady = ok; pagesDownloaded = ok ? TOTAL_PAGES : 0; });
    } else {
      downloadReady = true;
      checkDownloaded().then((ok) => { pagesDownloaded = ok ? TOTAL_PAGES : 0; });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (!localStorage.getItem('quran-install-dismissed')) {
        showInstallBanner = true;
      }
    });

    window.addEventListener('appinstalled', () => {
      showInstallBanner = false;
      deferredPrompt = null;
      localStorage.removeItem('quran-install-dismissed');
    });

    if ('serviceWorker' in navigator) {
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) showUpdateBanner = true;
        hadController = true;
      });
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
    preloadAdjacent(pageNum);
  }

  let preloadTimer;
  function preloadAdjacent(page) {
    clearTimeout(preloadTimer);
    preloadTimer = setTimeout(() => {
      if (page > 1) fetchPageSVG(page - 1).catch(() => {});
      if (page < TOTAL_PAGES) fetchPageSVG(page + 1).catch(() => {});
    }, 500);
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
    localStorage.setItem('quran-lang', lang);
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
      pageStates.clear();
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

  function openNavMenu() {
    targetPage = activePage;
    showNavMenu = true;
  }

  function closeNavMenu() {
    showNavMenu = false;
  }

  function onMenuSurahChange(e) {
    const s = surahs.find((s) => s.number === parseInt(e.target.value));
    if (s && s.startPage) targetPage = s.startPage;
  }

  function onMenuJuzChange(e) {
    const j = parseInt(e.target.value);
    if (j) targetPage = (j - 1) * 20 + 1;
  }

  function onMenuPageChange(e) {
    const p = parseInt(e.target.value);
    if (p >= 1 && p <= TOTAL_PAGES) targetPage = p;
  }

  function goToNavTarget() {
    goToPage(targetPage);
    showNavMenu = false;
  }

  function openSettings() {
    showSettings = true;
  }

  function closeSettings() {
    showSettings = false;
  }

  async function startDownloadAll() {
    if (isDownloading) return;
    isDownloading = true;
    downloadProgress = 0;
    try {
      await startDownload(
        (done) => { downloadProgress = done; },
        (page, msg) => { console.error('Download error page', page, msg); }
      );
      pagesDownloaded = TOTAL_PAGES;
    } catch (e) {
      console.error('Download failed', e);
    }
    isDownloading = false;
  }

  async function deleteAllPages() {
    if (isDownloading) return;
    await clearAllPages();
    pagesDownloaded = 0;
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    showInstallBanner = false;
  }

  function dismissInstallBanner() {
    showInstallBanner = false;
    deferredPrompt = null;
    localStorage.setItem('quran-install-dismissed', '1');
  }

  function trapFocus(e, container) {
    if (e.key !== 'Tab') return;
    const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length < 2) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleToggleAll() {
    if (!activeLayout) return;
    eyeOpen = !eyeOpen;
    if (eyeOpen) {
      activeRevealed = activeLayout.totalWords - 1;
    } else {
      activeRevealed = -1;
      pageStates.clear();
    }
    persistState();
  }

  function handleToggleTheme() {
    darkTheme = !darkTheme;
    document.documentElement.classList.toggle('light', !darkTheme);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', darkTheme ? '#000000' : '#f5f5f5');
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
  <DownloadScreen onComplete={onDownloadComplete} {t} />
{:else if downloadReady === true}
  {#if errorMsg}
    <div class="global-error">{errorMsg}</div>
  {/if}

  <header class="top-bar">
    <span class="top-bar-left">{currentSurah.name}</span>
    <span class="top-bar-right">
      <span class="top-bar-juz">{t.juz} {activeJuz}</span>
      <button class="top-bar-btn" onclick={openSettings} title={t.settings}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </span>
  </header>

  <div
    class="page-container"
    bind:this={pageContainerEl}
    role="application"
    aria-label={t.appAriaLabel}
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <div class="page-stack">
      <MushafPage pageNumber={activePage} revealedUpto={activeRevealed} onLoaded={onPageLoaded} {t} />
    </div>
  </div>

  <footer class="bottom-bar">
      <div class="bottom-page">{t.page} {activePage}</div>
      <div class="bottom-toggles">
        <button class="bottom-btn" onclick={openNavMenu} title={t.openNav}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor"/>
          </svg>
        </button>
        <button class="bottom-btn" onclick={handleToggleAll} title={eyeOpen ? t.hideAll : t.showAll}>
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
        <button class="bottom-btn" onclick={handleToggleTheme} title={darkTheme ? t.lightMode : t.darkMode}>
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
      <div class="bottom-hints">
        {#if isTouchDevice}
          {t.touchHint}
        {:else}
          <span><kbd>Space</kbd>/<kbd>&larr;</kbd> {t.nextWord} &middot;</span>
          <span><kbd>Shift</kbd>+<kbd>Space</kbd> {t.nextAyah} &middot;</span>
          <span><kbd>h</kbd> {t.hideAll} &middot; <kbd>s</kbd> {t.showAll} &middot;</span>
          <span><kbd>n</kbd>/<kbd>p</kbd> {t.nextPage}/{t.prevPage}</span>
        {/if}
      </div>
    </footer>

  {#if showNavMenu}
    <div class="nav-menu-backdrop" onclick={closeNavMenu} onkeydown={(e) => e.key === 'Escape' && closeNavMenu()} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="nav-menu" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div class="nav-menu-field">
          <span class="nav-menu-label">{t.surah}</span>
          <select class="nav-menu-select" value={menuSurah} onchange={onMenuSurahChange}>
            <option value="">{t.surahPlaceholder}</option>
            {#each surahs as s}
              <option value={s.number}>{s.number}. {lang === 'ar' ? s.arabic : s.name}</option>
            {/each}
          </select>
        </div>
        <div class="nav-menu-field">
          <span class="nav-menu-label">{t.juz}</span>
          <select class="nav-menu-select" value={menuJuz} onchange={onMenuJuzChange}>
            {#each Array.from({ length: 30 }, (_, i) => i + 1) as j}
              <option value={j}>{t.juz} {j}</option>
            {/each}
          </select>
        </div>
        <div class="nav-menu-field">
          <span class="nav-menu-label">{t.page}</span>
          <select class="nav-menu-select" value={menuPage} onchange={onMenuPageChange}>
            {#each Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1) as p}
              <option value={p}>{t.page} {p}</option>
            {/each}
          </select>
        </div>
        <button class="nav-menu-go" onclick={goToNavTarget}>{t.go}</button>
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div class="nav-menu-backdrop" onclick={closeSettings} onkeydown={(e) => e.key === 'Escape' && closeSettings()} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="nav-menu" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 class="nav-menu-heading">{t.settings}</h2>

        <div class="settings-section">
          <p class="settings-section-title">{t.offlineStorage}</p>
          {#if isDownloading}
            <div class="ds-bar-track">
              <div class="ds-bar-fill" style="width: {downloadProgress / TOTAL_PAGES * 100}%"></div>
            </div>
            <p class="settings-status">{downloadProgress} / {TOTAL_PAGES} {t.pages}</p>
          {:else if isDownloaded}
            <p class="settings-status settings-ok">{t.allCached}</p>
            <button class="nav-menu-go nav-menu-go-danger" onclick={deleteAllPages}>{t.deleteDownloaded}</button>
          {:else}
            <button class="nav-menu-go" onclick={startDownloadAll}>{t.downloadAll}</button>
            <p class="settings-status">{t.pagesWillBeCached}</p>
          {/if}
        </div>

        <div class="settings-section">
          <p class="settings-section-title">{t.appearance}</p>
          <button class="nav-menu-go nav-menu-go-secondary" onclick={handleToggleTheme}>
            {t.themeToggle.replace('{mode}', darkTheme ? t.darkMode : t.lightMode)}
          </button>
        </div>

        <div class="settings-section">
          <p class="settings-section-title">{t.language}</p>
          <select class="nav-menu-select" value={lang} onchange={(e) => lang = e.target.value}>
            {#each LANGUAGES as l}
              <option value={l.code}>{l.name}</option>
            {/each}
          </select>
        </div>

        <button class="nav-menu-go nav-menu-go-secondary" onclick={closeSettings}>{t.close}</button>
      </div>
    </div>
  {/if}

  {#if showInstallBanner}
    <div class="install-banner">
      <span class="install-banner-text">{t.installText}</span>
      <div class="install-banner-actions">
        <button class="install-btn install-btn-primary" onclick={handleInstall}>{t.install}</button>
        <button class="install-btn install-btn-dismiss" onclick={dismissInstallBanner}>{t.notNow}</button>
      </div>
    </div>
  {/if}

  {#if showUpdateBanner}
    <div class="install-banner">
      <span class="install-banner-text">{t.newVersion}</span>
      <div class="install-banner-actions">
        <button class="install-btn install-btn-primary" onclick={() => location.reload()}>{t.reload}</button>
        <button class="install-btn install-btn-dismiss" onclick={() => showUpdateBanner = false}>{t.later}</button>
      </div>
    </div>
  {/if}

  {#if showOverlay}
    <div class="overlay-backdrop" onclick={() => (showOverlay = false)} onkeydown={(e) => e.key === 'Escape' && (showOverlay = false)} role="presentation">
      <div class="overlay-card" tabindex="-1" bind:this={shortcutOverlayEl} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { e.key === 'Tab' && trapFocus(e, e.currentTarget); e.stopPropagation(); }} role="dialog" aria-modal="true">
        <h2>{t.keyboardShortcuts}</h2>
        <table class="shortcut-table">
          <tbody>
            <tr><td><kbd>Space</kbd> / <kbd>&larr;</kbd></td><td>{t.nextWord}</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>Space</kbd> / <kbd>Shift</kbd> + <kbd>&larr;</kbd></td><td>{t.nextAyah}</td></tr>
            <tr><td><kbd>Backspace</kbd> / <kbd>&rarr;</kbd></td><td>{t.prevWord}</td></tr>
            <tr><td><kbd>Shift</kbd> + <kbd>&rarr;</kbd></td><td>{t.prevAyah}</td></tr>
            <tr><td><kbd>h</kbd></td><td>{t.hideAllAyahs}</td></tr>
            <tr><td><kbd>s</kbd></td><td>{t.showAllAyahs}</td></tr>
            <tr><td><kbd>t</kbd></td><td>{t.toggleTheme}</td></tr>
            <tr><td><kbd>n</kbd> / <kbd>PgDn</kbd></td><td>{t.nextPage}</td></tr>
            <tr><td><kbd>p</kbd> / <kbd>PgUp</kbd></td><td>{t.prevPage}</td></tr>
            <tr><td><kbd>Home</kbd></td><td>{t.firstPage}</td></tr>
            <tr><td><kbd>End</kbd></td><td>{t.lastPage}</td></tr>
            <tr><td><kbd>?</kbd></td><td>{t.toggleOverlay}</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>{t.closeOverlay}</td></tr>
          </tbody>
        </table>
        <p class="overlay-touch-note">{t.touchNote}</p>
        <button class="overlay-close" onclick={() => (showOverlay = false)}>{t.close}</button>
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
    touch-action: manipulation;
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
