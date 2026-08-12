<script lang="ts">
  import Button from 'tint/components/Button.svelte'

  interface Props {
    markup: string
  }

  let { markup }: Props = $props()

  let status = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    clearTimeout(timer)
    try {
      await navigator.clipboard.writeText(markup)
      status = 'Copied the original SVG source.'
    } catch {
      status = 'Copying failed. Use the markup below instead.'
    }
    timer = setTimeout(() => (status = ''), 4000)
  }
</script>

{#if markup}
  <div class="copy">
    <Button variant="secondary" small onclick={copy}>Copy SVG source</Button>
    <p aria-live="polite" class="tint--type-ui-small status">{status}</p>
  </div>
{/if}

<style lang="sass">
  .copy
    display: flex
    align-items: center
    gap: var(--tint-size-8)
    flex-wrap: wrap
    margin-block-start: var(--tint-size-16)

  .status
    color: var(--tint-text-secondary)
</style>
