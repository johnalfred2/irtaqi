<script>
  import { findSurahByPage } from '../lib/surahs.js';

  let { currentPage = 1, totalPages = 604, surahs = [], onPageChange, eyeOpen = false, onToggleAll, darkTheme = true, onToggleTheme } = $props();

  let currentJuz = $derived(Math.min(30, Math.floor((currentPage - 1) / 20) + 1));
  let currentSurah = $derived(findSurahByPage(currentPage).number);

  function prevPage() {
    if (currentPage > 1) onPageChange(currentPage - 1);
  }

  function nextPage() {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  }

  function goToSurah(e) {
    const num = parseInt(e.target.value);
    if (num) {
      const surah = surahs.find((s) => s.number === num);
      if (surah && surah.startPage) {
        onPageChange(surah.startPage);
      }
    }
  }

  function goToJuz(e) {
    const juz = parseInt(e.target.value);
    if (juz) {
      onPageChange((juz - 1) * 20 + 1);
    }
  }

  function goToPage(e) {
    const num = parseInt(e.target.value);
    if (num >= 1 && num <= totalPages) {
      onPageChange(num);
    }
  }
</script>

<div class="page-nav">
  <div class="nav-selectors">
    <select class="nav-select" value={currentSurah} onchange={goToSurah}>
      <option value="">Surah...</option>
      {#each surahs as s}
        <option value={s.number}>{s.number}. {s.name}</option>
      {/each}
    </select>

    <select class="nav-select" value={currentJuz} onchange={goToJuz}>
      {#each Array.from({ length: 30 }, (_, i) => i + 1) as juz}
        <option value={juz}>Juz {juz}</option>
      {/each}
    </select>

    <select class="nav-select" value={currentPage} onchange={goToPage}>
      {#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
        <option value={p}>Page {p}</option>
      {/each}
    </select>
  </div>

  <div class="nav-buttons">
    <button class="nav-btn nav-btn-eye" onclick={onToggleAll} title={eyeOpen ? 'Hide all' : 'Show all'}>
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
    <button class="nav-btn nav-btn-theme" onclick={onToggleTheme} title={darkTheme ? 'Light mode' : 'Dark mode'}>
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
    <button class="nav-btn" onclick={nextPage} disabled={currentPage >= totalPages}>
      &#9664; Next
    </button>
    <button class="nav-btn" onclick={prevPage} disabled={currentPage <= 1}>
      Prev &#9654;
    </button>
  </div>
</div>
