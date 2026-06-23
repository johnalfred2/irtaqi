<script>
  import Word from './Word.svelte';

  let { line = null, revealedUpto = -1, fontFamily = '' } = $props();

  let fontStyle = $derived(fontFamily ? `font-family: '${fontFamily}', 'Uthmanic', serif;` : `font-family: 'Uthmanic', serif;`);
</script>

{#if line}
  {#if line.type === 'surah-header'}
    <div class="line surah-header">{line.text}</div>
  {:else if line.type === 'basmala'}
    <div class="line basmala" style="font-family: 'Uthmanic', serif;">
      {line.text}
    </div>
  {:else if line.type === 'text'}
    <div class="line text-line" style={fontStyle}>
      {#each line.words as word}
        <Word
          text={(fontFamily && word.qpcV2) ? word.qpcV2 : word.text}
          state={word.index <= revealedUpto ? 'revealed' : word.index <= revealedUpto + 4 ? 'context' : 'hidden'}
        />{' '}
      {/each}
    </div>
  {/if}
{/if}
