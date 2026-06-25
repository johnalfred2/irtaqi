<script>
  import { startDownload, checkDownloaded } from '../lib/downloadManager.js';

  let { onComplete } = $props();

  let progress = $state(0);
  let total = $state(0);
  let status = $state('Downloading Quran pages...');
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
          error = `Error on page ${page}: ${msg}`;
        }
      );
      ready = true;
    } catch (e) {
      error = e.message;
      running = false;
    }
  }

  $effect(() => {
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

<div class="download-screen">
  {#if ready}
    <div class="ds-card">
      <p class="ds-ready">All pages downloaded successfully.</p>
      <button class="ds-btn" onclick={enter}>Open Quran</button>
    </div>
  {:else if !running}
    <div class="ds-card">
      <h1 class="ds-title">Quran Assistant</h1>
      <p class="ds-desc">
        Download all 604 Quran pages for offline reading.
        This one-time download requires an internet connection.
      </p>
      <button class="ds-btn ds-btn-primary" onclick={begin}>Start Download</button>
    </div>
  {:else}
    <div class="ds-card">
      <h1 class="ds-title">Downloading...</h1>
      <div class="ds-bar-track">
        <div class="ds-bar-fill" style="width: {total > 0 ? (progress / total) * 100 : 0}%"></div>
      </div>
      <p class="ds-count">
        <span class="ds-num">{progress}</span> / <span class="ds-num">{total}</span> pages
      </p>
      <p class="ds-status">{status}</p>
      {#if error}
        <p class="ds-error">{error}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .download-screen {
    position: fixed;
    inset: 0;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 24px;
    color: #e0e0e0;
    font-family: sans-serif;
  }

  .ds-card {
    text-align: center;
    max-width: 400px;
    width: 100%;
  }

  .ds-title {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 16px;
    color: #e0e0e0;
  }

  .ds-desc {
    font-size: 14px;
    color: #888;
    margin: 0 0 28px;
    line-height: 1.5;
  }

  .ds-bar-track {
    height: 6px;
    border-radius: 3px;
    background: #222;
    overflow: hidden;
    margin: 20px 0 12px;
  }

  .ds-bar-fill {
    height: 100%;
    background: #e0e0e0;
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .ds-count {
    font-size: 13px;
    color: #888;
    margin: 0 0 4px;
  }

  .ds-num {
    color: #e0e0e0;
    font-variant-numeric: tabular-nums;
  }

  .ds-status {
    font-size: 12px;
    color: #555;
    margin: 0;
  }

  .ds-error {
    font-size: 11px;
    color: #ff6b6b;
    margin: 8px 0 0;
  }

  .ds-btn {
    padding: 12px 32px;
    border: 1px solid #333;
    border-radius: 8px;
    background: #111;
    color: #e0e0e0;
    font-size: 15px;
    cursor: pointer;
    min-height: 44px;
    transition: background 0.15s;
  }

  .ds-btn:hover {
    background: #222;
  }

  .ds-btn-primary {
    background: #222;
    border-color: #555;
  }

  .ds-btn-primary:hover {
    background: #333;
  }

  .ds-ready {
    font-size: 15px;
    color: #4caf50;
    margin: 0 0 24px;
  }
</style>
