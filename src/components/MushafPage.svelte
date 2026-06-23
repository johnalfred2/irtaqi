<script>
  import Line from './Line.svelte';
  import { fetchPageLayout, loadQPCFont } from '../lib/api.js';
  import { parsePageLayout } from '../lib/layout.js';

  let { pageNumber = 1, revealedUpto = -1 } = $props();

  let layout = $state(null);
  let fontFamily = $state('');
  let loadError = $state(false);
  let isLoading = $state(false);

  $effect(() => {
    loadPage(pageNumber);
  });

  async function loadPage(num) {
    isLoading = true;
    loadError = false;
    fontFamily = '';
    try {
      const raw = await fetchPageLayout(num);
      layout = parsePageLayout(raw);
      isLoading = false;
      loadQPCFont(num).then(name => {
        if (num === pageNumber) fontFamily = name;
      }).catch(e => {
        console.warn('QPC font failed for page', num, e);
      });
    } catch (e) {
      console.error('Failed to load page', num, e);
      loadError = true;
      isLoading = false;
    }
  }
</script>

<div class="mushaf-page" class:loading={isLoading}>
  {#if isLoading}
    <div class="page-loading">Loading page {pageNumber}...</div>
  {:else if loadError}
    <div class="page-error">Failed to load page {pageNumber}</div>
  {:else if layout}
    {#each layout.lines as line}
      <Line {line} {revealedUpto} {fontFamily} />
    {/each}
  {/if}
</div>
