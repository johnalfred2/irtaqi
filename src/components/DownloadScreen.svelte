<script>
  import { startDownload, checkDownloaded } from '../lib/downloadManager.js';
  import { formatNumber } from '../lib/i18n.js';

  let { onComplete, t = null, lang = 'en' } = $props();

  let progress = $state(0);
  let total = $state(0);
  let status = $derived(t ? t.downloadQuran : 'Downloading Quran pages...');
  let error = $state('');
  let ready = $state(false);
  let running = $state(false);

  async function begin() {
    running = true;
    error = '';
    ready = false;
    try {
      await startDownload(
        (done, all) => {
          progress = done;
          total = all;
        },
        (page, msg) => {
          error = `${t ? t.errorOnPage : 'Error on page'} ${page}: ${msg}`;
        }
      );
      ready = true;
    } catch (e) {
      error = e.message;
      running = false;
    }
  }

  import { onMount } from 'svelte';

  onMount(() => {
    checkDownloaded().then((ok) => {
      if (ok) {
        ready = true;
      }
    });
  });

  function enter() {
    if (onComplete) onComplete();
  }
</script>

<div class="fixed inset-0 bg-black flex items-center justify-center z-200 p-6 text-[#e0e0e0] font-sans">
  {#if ready}
    <div class="text-center max-w-[400px] w-full">
      <p class="text-[15px] text-green-600 m-0 mb-6">{t ? t.allDownloaded : 'All pages downloaded successfully.'}</p>
      <button class="px-8 py-3 border border-[#333] rounded-lg bg-[#111] text-[#e0e0e0] text-[15px] cursor-pointer min-h-[44px] transition-[background] duration-150 hover:bg-[#222]" onclick={enter}>{t ? t.openQuran : 'Open Quran'}</button>
    </div>
  {:else if !running}
    <div class="text-center max-w-[400px] w-full">
      <h1 class="text-[22px] font-semibold m-0 mb-4 text-[#e0e0e0]">{t ? t.quranAssistant : 'Quran Assistant'}</h1>
      <p class="text-sm text-[#888] m-0 mb-7 leading-[1.5]">
        {t ? t.downloadDesc1 : 'Download all 604 Quran pages for offline reading.'}
        <br/>
        {t ? t.downloadDesc2 : 'This one-time download requires an internet connection.'}
      </p>
      <button class="px-8 py-3 border border-[#555] rounded-lg bg-[#222] text-[#e0e0e0] text-[15px] cursor-pointer min-h-[44px] transition-[background] duration-150 hover:bg-[#333]" onclick={begin}>{t ? t.startDownload : 'Start Download'}</button>
    </div>
  {:else}
    <div class="text-center max-w-[400px] w-full">
      <h1 class="text-[22px] font-semibold m-0 mb-4 text-[#e0e0e0]">{t ? t.downloadTitle : 'Downloading...'}</h1>
      <div class="h-[6px] rounded-[3px] bg-[#222] overflow-hidden my-5">
        <div class="h-full bg-[#e0e0e0] rounded-[3px] transition-[width] duration-300" style="width: {total > 0 ? (progress / total) * 100 : 0}%"></div>
      </div>
      <p class="text-sm text-[#888] m-0 mb-1">
        <span class="text-[#e0e0e0] tabular-nums">{formatNumber(progress, lang)}</span> / <span class="text-[#e0e0e0] tabular-nums">{formatNumber(total, lang)}</span> {t ? t.pages : 'pages'}
      </p>
      <p class="text-xs text-[#555] m-0">{status}</p>
      {#if error}
        <p class="text-xs text-[#ff6b6b] mt-2">{error}</p>
      {/if}
    </div>
  {/if}
</div>
