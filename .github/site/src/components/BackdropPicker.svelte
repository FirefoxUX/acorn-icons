<script lang="ts">
  import SegmentedControl from 'tint/components/SegmentedControl.svelte'
  import iconLaptop from 'tint/icons/20-laptop.svg?raw'
  import iconMoon from 'tint/icons/20-moon.svg?raw'
  import iconSun from 'tint/icons/20-sun.svg?raw'
  import iconTransparent from 'tint/icons/20-transparent.svg?raw'

  interface Props {
    id?: string
  }

  let { id = 'backdrop' }: Props = $props()

  // `aria-label` without `title`, so the reader gets the name once from tint's
  // tooltip rather than twice alongside the browser's own.
  const items = [
    {
      value: 'page',
      icon: iconLaptop,
      'aria-label': 'Page background',
      tooltip: 'Page background',
    },
    {
      value: 'light',
      icon: iconSun,
      'aria-label': 'Light background',
      tooltip: 'Light background',
    },
    {
      value: 'dark',
      icon: iconMoon,
      'aria-label': 'Dark background',
      tooltip: 'Dark background',
    },
    {
      value: 'checker',
      icon: iconTransparent,
      'aria-label': 'Transparency checkerboard',
      tooltip: 'Transparency checkerboard',
    },
  ]

  // Matches the `data-backdrop` the server rendered on the stage, so the first
  // client render agrees with the delivered HTML.
  let value = $state('page')
  let root: HTMLElement | undefined = $state(undefined)

  $effect(() => {
    const stage = root?.closest('[data-detail]')?.querySelector('[data-stage]')
    stage?.setAttribute('data-backdrop', value)
  })
</script>

<div class="picker" bind:this={root}>
  <SegmentedControl {id} {items} bind:value label="Preview backdrop" small />
</div>

<style lang="sass">
  .picker
    margin-block-start: var(--tint-size-12)
</style>
