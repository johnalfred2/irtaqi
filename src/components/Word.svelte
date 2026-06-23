<script>
  let { text = '', state = 'hidden' } = $props();
</script>

<span
  class="word"
  class:hidden={state === 'hidden'}
  class:context={state === 'context'}
  class:revealed={state === 'revealed'}
>{text}</span>
