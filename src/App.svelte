<script>
  import { onMount, onDestroy } from 'svelte';
  import MushafPage from './components/MushafPage.svelte';
  import PageNav from './components/PageNav.svelte';
  import DownloadScreen from './components/DownloadScreen.svelte';
  import { getNextAyahEnd, getPrevAyahStart, fetchPageSVG } from './lib/svgApi.js';
  import { getSurahList, findSurahByPage } from './lib/surahs.js';
  import { checkDownloaded, startDownload } from './lib/downloadManager.js';
  import { clearAllPages, getStoredPageCount } from './lib/storage.js';
  import { TOTAL_PAGES } from './lib/constants.js';
  import { LANGUAGES, getTranslations, formatNumber } from './lib/i18n.js';
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
  let lang = $state(localStorage.getItem('quran-lang') || 'en');
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

  $effect(() => {
    lang;
    localStorage.setItem('quran-lang', lang);
  });
  const pageStates = new Map();

  let activeJuz = $derived(Math.min(30, Math.floor((activePage - 1) / 20) + 1));
  let currentSurah = $derived(findSurahByPage(activePage));

  let pageContainerEl = $state(null);
  let touchStart = null;
  let longPressTimer = null;
  let longPressInterval = null;
  let activeTouches = 0;

  let wakeLock = null;

  function stopLongPress() {
    activeTouches = 0;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (longPressInterval) { clearTimeout(longPressInterval); longPressInterval = null; }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    window.addEventListener('pointerdown', () => { activeTouches++; });
    window.addEventListener('pointerup', stopLongPress);
    window.addEventListener('pointercancel', stopLongPress);

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
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    const savedLang = localStorage.getItem('quran-lang');
    if (urlLang && LANGUAGES.find(l => l.code === urlLang)) {
      lang = urlLang;
    } else if (savedLang) {
      lang = savedLang;
    } else {
      const browserLangs = navigator.languages || [navigator.language || 'en'];
      const browserLang = browserLangs.map(l => l.toLowerCase().slice(0, 2)).find(l => ['en', 'ar', 'tr'].includes(l)) || 'en';
      lang = LANGUAGES.find(l => l.code === browserLang) ? browserLang : 'en';
    }
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
    window.removeEventListener('pointerup', stopLongPress);
    window.removeEventListener('pointercancel', stopLongPress);
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
        const h = window.innerWidth / 2;
        const doLongPress = () => {
          if (activeTouches === 0) { clearTimeout(longPressInterval); longPressInterval = null; return; }
          if (touchStart.x < h) revealNextAyah();
          else hidePrevAyah();
          if (navigator.vibrate) navigator.vibrate(10);
        };
        const scheduleNext = () => {
          if (activeTouches === 0) return;
          longPressInterval = setTimeout(() => {
            doLongPress();
            scheduleNext();
          }, 800);
        };
        longPressInterval = setTimeout(() => {
          if (activeTouches === 0) return;
          doLongPress();
          scheduleNext();
        }, 900);
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
      if (longPressInterval) { clearTimeout(longPressInterval); longPressInterval = null; }
    }
  }

  function onTouchEnd(e) {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (longPressInterval) { clearTimeout(longPressInterval); longPressInterval = null; }
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
  <DownloadScreen onComplete={onDownloadComplete} {t} {lang} />
{:else if downloadReady === true}
  {#if errorMsg}
    <div class="global-error">{errorMsg}</div>
  {/if}

  <header class="flex items-center justify-between px-5 py-2.5 bg-(--bg) border-b border-(--border-secondary) shrink-0 z-50">
    <span class="text-clamp-title font-semibold text-(--text)">{lang === 'ar' ? currentSurah.arabic : lang === 'tr' ? currentSurah.turkish : currentSurah.name}</span>
    <span class="flex items-center gap-3">
      <span class="text-clamp-subtitle text-(--text-secondary)">{t.juz} {formatNumber(activeJuz, lang)}</span>
      <button class="btn-clamp-top rounded-full border-none bg-[rgba(128,128,128,0.12)] text-(--text-nav) flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[background] duration-150 active:bg-[rgba(128,128,128,0.25)]" onclick={openSettings} title={t.settings}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </span>
  </header>

  <div
    class="flex flex-col items-center justify-center p-1 flex-1 overflow-hidden min-h-0 [touch-action:manipulation]"
    bind:this={pageContainerEl}
    role="application"
    aria-label={t.appAriaLabel}
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <div class="relative flex-1 w-full min-h-0">
      <MushafPage pageNumber={activePage} revealedUpto={activeRevealed} onLoaded={onPageLoaded} {t} {lang} />
    </div>
  </div>

  <footer class="px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-(--bg) border-t border-(--border-secondary) flex flex-col items-center gap-2 shrink-0">
      <div class="text-clamp-page text-(--text-secondary) font-semibold mb-[0.15rem]">{t.page} {formatNumber(activePage, lang)}</div>
      <div class="flex items-center gap-4">
        <button class="btn-clamp-bottom rounded-full border-none bg-[rgba(128,128,128,0.12)] text-(--text-nav) flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[background] duration-150 active:bg-[rgba(128,128,128,0.25)]" onclick={openNavMenu} title={t.openNav}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor"/>
          </svg>
        </button>
        <button class="btn-clamp-bottom rounded-full border-none bg-[rgba(128,128,128,0.12)] text-(--text-nav) flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[background] duration-150 active:bg-[rgba(128,128,128,0.25)]" onclick={handleToggleAll} title={eyeOpen ? t.hideAll : t.showAll}>
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
        <button class="btn-clamp-bottom rounded-full border-none bg-[rgba(128,128,128,0.12)] text-(--text-nav) flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[background] duration-150 active:bg-[rgba(128,128,128,0.25)]" onclick={handleToggleTheme} title={darkTheme ? t.lightMode : t.darkMode}>
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
      <div class="text-clamp-hint text-(--text-muted) text-center leading-[1.4]">
        {#if isTouchDevice}
          {t.touchHint}
        {:else}
          <span><kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">Space</kbd>/<kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">&larr;</kbd> {t.nextWord} &middot;</span>
          <span><kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">Shift</kbd>+<kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">Space</kbd> {t.nextAyah} &middot;</span>
          <span><kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">h</kbd> {t.hideAllSmall} &middot; <kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">s</kbd> {t.showAllSmall} &middot;</span>
          <span><kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">n</kbd>/<kbd class="bg-(--bg-tertiary) border border-(--border) rounded px-[5px] py-[1px] font-mono text-clamp-kbd text-(--text)">p</kbd> {t.nextPrevPage}</span>
        {/if}
      </div>
    </footer>

  {#if showNavMenu}
    <div class="fixed inset-0 backdrop-blur-[6px] bg-[rgba(0,0,0,0.25)] flex items-center justify-center z-100 p-4 light:bg-[rgba(255,255,255,0.25)]" onclick={closeNavMenu} onkeydown={(e) => e.key === 'Escape' && closeNavMenu()} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="max-w-[400px] w-full bg-(--bg-secondary) border border-(--border) rounded-xl p-5 pb-4 shadow-[0_8px_32px_var(--card-shadow)] flex flex-col gap-3.5" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-(--text) min-w-[52px] shrink-0">{t.surah}</span>
          <select class="flex-1 px-3 py-2.5 border border-(--border) rounded-md bg-(--bg) text-(--text) text-sm cursor-pointer min-h-[44px]" value={menuSurah} onchange={onMenuSurahChange}>
            {#each surahs as s}
              <option value={s.number} class="bg-(--bg) text-(--text)">{formatNumber(s.number, lang)}. {lang === 'ar' ? s.arabic : lang === 'tr' ? s.turkish : s.name}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-(--text) min-w-[52px] shrink-0">{t.juz}</span>
          <select class="flex-1 px-3 py-2.5 border border-(--border) rounded-md bg-(--bg) text-(--text) text-sm cursor-pointer min-h-[44px]" value={menuJuz} onchange={onMenuJuzChange}>
            {#each Array.from({ length: 30 }, (_, i) => i + 1) as j}
              <option value={j} class="bg-(--bg) text-(--text)">{t.juz} {formatNumber(j, lang)}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm font-semibold text-(--text) min-w-[52px] shrink-0">{t.page}</span>
          <select class="flex-1 px-3 py-2.5 border border-(--border) rounded-md bg-(--bg) text-(--text) text-sm cursor-pointer min-h-[44px]" value={menuPage} onchange={onMenuPageChange}>
            {#each Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1) as p}
              <option value={p} class="bg-(--bg) text-(--text)">{t.page} {formatNumber(p, lang)}</option>
            {/each}
          </select>
        </div>
        <button class="w-full py-3 border-none rounded-lg bg-(--text) text-(--bg) text-sm font-semibold cursor-pointer transition-opacity duration-150 hover:opacity-85 active:opacity-70 min-h-[44px]" onclick={goToNavTarget}>{t.go}</button>
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div class="fixed inset-0 backdrop-blur-[6px] bg-[rgba(0,0,0,0.25)] flex items-center justify-center z-100 p-4 light:bg-[rgba(255,255,255,0.25)]" onclick={closeSettings} onkeydown={(e) => e.key === 'Escape' && closeSettings()} role="presentation">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="max-w-[400px] w-full bg-(--bg-secondary) border border-(--border) rounded-xl p-5 pb-4 shadow-[0_8px_32px_var(--card-shadow)] flex flex-col gap-3.5" tabindex="-1" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 class="m-0 text-lg font-semibold text-(--text)">{t.settings}</h2>

        <div class="pt-1">
          <p class="text-xs font-semibold text-(--text-muted) uppercase tracking-[0.5px] mb-2">{t.offlineStorage}</p>
          {#if isDownloading}
            <div class="h-[6px] rounded-[3px] bg-(--bg-tertiary) overflow-hidden my-2">
              <div class="h-full bg-(--text) rounded-[3px] transition-[width] duration-300" style="width: {downloadProgress / TOTAL_PAGES * 100}%"></div>
            </div>
            <p class="text-xs text-(--text-secondary) mt-[6px]">{formatNumber(downloadProgress, lang)} / {formatNumber(TOTAL_PAGES, lang)} {t.pages}</p>
          {:else if isDownloaded}
            <p class="text-xs text-(--text-secondary) mt-[6px] text-green-600">{t.allCached}</p>
            <button class="w-full py-3 border border-[#ff6b6b] rounded-lg bg-transparent text-[#ff6b6b] text-sm font-semibold cursor-pointer transition-[background] duration-150 hover:bg-[rgba(255,107,107,0.1)] min-h-[44px]" onclick={deleteAllPages}>{t.deleteDownloaded}</button>
          {:else}
            <button class="w-full py-3 border-none rounded-lg bg-(--text) text-(--bg) text-sm font-semibold cursor-pointer transition-opacity duration-150 hover:opacity-85 active:opacity-70 min-h-[44px]" onclick={startDownloadAll}>{t.downloadAll}</button>
            <p class="text-xs text-(--text-secondary) mt-[6px]">{t.pagesWillBeCached}</p>
          {/if}
        </div>

        <div class="pt-1">
          <p class="text-xs font-semibold text-(--text-muted) uppercase tracking-[0.5px] mb-2">{t.appearance}</p>
          <button class="w-full py-3 border-none rounded-lg bg-(--bg-tertiary) text-(--text) text-sm font-semibold cursor-pointer transition-opacity duration-150 hover:opacity-85 min-h-[44px]" onclick={handleToggleTheme}>
            {t.themeToggle.replace('{mode}', darkTheme ? t.dark : t.light)}
          </button>
        </div>

        <div class="pt-1">
          <p class="text-xs font-semibold text-(--text-muted) uppercase tracking-[0.5px] mb-2">{t.language}</p>
          <select class="flex-1 w-full px-3 py-2.5 border border-(--border) rounded-md bg-(--bg) text-(--text) text-sm cursor-pointer min-h-[44px]" value={lang} onchange={(e) => lang = e.target.value}>
            {#each LANGUAGES as l}
              <option value={l.code} class="bg-(--bg) text-(--text)">{l.name}</option>
            {/each}
          </select>
        </div>

        <button class="w-full py-3 border-none rounded-lg bg-(--bg-tertiary) text-(--text) text-sm font-semibold cursor-pointer transition-opacity duration-150 hover:opacity-85 min-h-[44px]" onclick={closeSettings}>{t.close}</button>
      </div>
    </div>
  {/if}

  {#if showInstallBanner}
    <div class="fixed bottom-0 left-0 right-0 z-90 bg-(--bg-secondary) border-t border-(--border) px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-between gap-3 backdrop-blur-[6px]">
      <span class="text-sm text-(--text) leading-[1.3]">{t.installText}</span>
      <div class="flex gap-2 shrink-0">
        <button class="px-4 py-2 border-none rounded-md bg-(--text) text-(--bg) text-sm font-semibold cursor-pointer min-h-[36px] transition-opacity duration-150 active:opacity-70" onclick={handleInstall}>{t.install}</button>
        <button class="px-4 py-2 border border-(--border) rounded-md bg-transparent text-(--text-secondary) text-sm font-semibold cursor-pointer min-h-[36px] transition-opacity duration-150 active:opacity-70" onclick={dismissInstallBanner}>{t.notNow}</button>
      </div>
    </div>
  {/if}

  {#if showUpdateBanner}
    <div class="fixed bottom-0 left-0 right-0 z-90 bg-(--bg-secondary) border-t border-(--border) px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center justify-between gap-3 backdrop-blur-[6px]">
      <span class="text-sm text-(--text) leading-[1.3]">{t.newVersion}</span>
      <div class="flex gap-2 shrink-0">
        <button class="px-4 py-2 border-none rounded-md bg-(--text) text-(--bg) text-sm font-semibold cursor-pointer min-h-[36px] transition-opacity duration-150 active:opacity-70" onclick={() => location.reload()}>{t.reload}</button>
        <button class="px-4 py-2 border border-(--border) rounded-md bg-transparent text-(--text-secondary) text-sm font-semibold cursor-pointer min-h-[36px] transition-opacity duration-150 active:opacity-70" onclick={() => showUpdateBanner = false}>{t.later}</button>
      </div>
    </div>
  {/if}

  {#if showOverlay}
    <div class="fixed inset-0 bg-(--overlay-bg) flex items-center justify-center z-100 p-4" onclick={() => (showOverlay = false)} onkeydown={(e) => e.key === 'Escape' && (showOverlay = false)} role="presentation">
      <div class="bg-(--bg-secondary) border border-(--border) rounded-lg px-7 py-6 max-w-[460px] w-full max-h-[90vh] overflow-y-auto shadow-[0_8px_32px_var(--card-shadow)]" tabindex="-1" bind:this={shortcutOverlayEl} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { e.key === 'Tab' && trapFocus(e, e.currentTarget); e.stopPropagation(); }} role="dialog" aria-modal="true">
        <h2 class="m-0 mb-4 text-lg font-semibold text-(--text)">{t.keyboardShortcuts}</h2>
        <table class="w-full border-collapse text-sm">
          <tbody>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Space</kbd> / <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">&larr;</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.nextWord}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Shift</kbd> + <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Space</kbd> / <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Shift</kbd> + <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">&larr;</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.nextAyah}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Backspace</kbd> / <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">&rarr;</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.prevWord}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Shift</kbd> + <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">&rarr;</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.prevAyah}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">h</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.hideAllAyahs}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">s</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.showAllAyahs}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">t</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.toggleTheme}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">n</kbd> / <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">PgDn</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.nextPage}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">p</kbd> / <kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">PgUp</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.prevPage}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Home</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.firstPage}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">End</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.lastPage}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">?</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.toggleOverlay}</td></tr>
            <tr><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text) whitespace-nowrap w-[45%]"><kbd class="bg-(--bg) border border-(--border) rounded px-[5px] py-[1px] font-mono text-xs text-(--text)">Esc</kbd></td><td class="px-1 py-2 border-b border-(--border-secondary) text-(--text)">{t.closeOverlay}</td></tr>
          </tbody>
        </table>
        <p class="my-4 mb-5 text-xs text-(--text-secondary) leading-[1.5]">{t.touchNote}</p>
        <button class="block mx-auto px-6 py-2 border border-(--border) rounded-md bg-(--bg-tertiary) text-(--text) text-sm cursor-pointer hover:bg-(--border)" onclick={() => (showOverlay = false)}>{t.close}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .global-error {
    background: #ff4444;
    color: #fff;
    padding: 12px 24px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
  }
</style>
