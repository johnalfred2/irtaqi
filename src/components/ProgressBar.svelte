<script>
  let { revealed = 0, total = 0 } = $props();
  let pct = $derived(total > 0 ? Math.round((revealed / total) * 100) : 0);
</script>

<div class="progress-bar">
  <div class="progress-fill" style="width: {pct}%"></div>
  <span class="progress-label">{pct}% ({revealed}/{total} words)</span>
</div>
