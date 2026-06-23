<script>
  let { surahName = '', surahArabic = '', pageNumber = 1, totalPages = 604, juz = 0 } = $props();
</script>

<div class="header">
  <div class="header-left">
    <span class="surah-name">{surahName}</span>
    <span class="surah-arabic">{surahArabic}</span>
  </div>
  <div class="header-right">
    <span class="page-number">Page {pageNumber} / {totalPages}</span>
    {#if juz > 0}
      <span class="juz-badge">Juz {juz}</span>
    {/if}
  </div>
</div>
