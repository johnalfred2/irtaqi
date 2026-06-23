<script>
  let { currentPage = 1, totalPages = 604, surahs = [], onPageChange } = $props();

  let currentJuz = $derived(Math.floor((currentPage - 1) / 20) + 1);

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
  <button class="nav-btn" onclick={prevPage} disabled={currentPage <= 1}>
    &#9664; Prev
  </button>

  <select class="surah-select" onchange={goToSurah}>
    <option value="">Surah...</option>
    {#each surahs as s}
      <option value={s.number}>{s.number}. {s.name}</option>
    {/each}
  </select>

  <select class="juz-select" value={currentJuz} onchange={goToJuz}>
    {#each Array.from({ length: 30 }, (_, i) => i + 1) as juz}
      <option value={juz}>Juz {juz}</option>
    {/each}
  </select>

  <div class="page-jump">
    <input
      class="page-input"
      type="number"
      min="1"
      max={totalPages}
      value={currentPage}
      onchange={goToPage}
    />
    <span class="page-total">/ {totalPages}</span>
  </div>

  <button class="nav-btn" onclick={nextPage} disabled={currentPage >= totalPages}>
    Next &#9654;
  </button>
</div>
