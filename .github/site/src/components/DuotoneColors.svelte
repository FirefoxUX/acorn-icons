<script lang="ts">
  import Button from 'tint/components/Button.svelte'
  import iconRevert from 'tint/icons/20-revert.svg?raw'
  import ColorPicker from 'tint/components/ColorPicker/ColorPicker.svelte'

  interface Props {
    id?: string
  }

  let { id = 'duotone' }: Props = $props()

  let root: HTMLElement | undefined = $state(undefined)
  let fill = $state('#000000')
  let fill2 = $state('#000000')
  let customized = $state(false)

  function stage(): HTMLElement | null | undefined {
    return root?.closest('[data-detail]')?.querySelector('[data-stage]')
  }

  // The canvas turns any computed color, including the `color-mix()` values the
  // theme uses, into the `#rrggbb` form an `<input type="color">` accepts.
  function toHex(color: string): string {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) {
      return '#000000'
    }
    context.fillStyle = '#000000'
    context.fillStyle = color
    return context.fillStyle
  }

  // Reads the colors the stage currently resolves, so the inputs start on what
  // is drawn rather than on black.
  function readDefaults() {
    const element = stage()
    if (!element || customized) {
      return
    }
    // The second channel is a custom property, so it is resolved through a
    // probe element that paints with it.
    const probe = document.createElement('span')
    probe.style.color = 'var(--asset-fill-2)'
    element.append(probe)
    fill2 = toHex(getComputedStyle(probe).color)
    probe.remove()
    fill = toHex(getComputedStyle(element).color)
  }

  $effect(() => {
    readDefaults()
    const element = stage()
    if (!element) {
      return
    }
    // A new backdrop changes the default colors.
    const observer = new MutationObserver(readDefaults)
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['data-backdrop'],
    })
    return () => observer.disconnect()
  })

  function apply(property: '--stage-fg' | '--asset-fill-2', color: string) {
    customized = true
    stage()?.style.setProperty(property, color)
  }

  function reset() {
    customized = false
    stage()?.style.removeProperty('--stage-fg')
    stage()?.style.removeProperty('--asset-fill-2')
    readDefaults()
  }
</script>

<div class="colors" bind:this={root}>
  <div class="picker">
    <ColorPicker
      id={`${id}-fill`}
      label="Fill"
      bind:value={fill}
      onchange={({ value }) => apply('--stage-fg', value)}
    />
  </div>
  <div class="picker">
    <ColorPicker
      id={`${id}-fill-2`}
      label="Second color"
      bind:value={fill2}
      onchange={({ value }) => apply('--asset-fill-2', value)}
    />
  </div>
  <Button
    icon
    variant="secondary"
    tooltip="Reset colors"
    aria-label="Reset colors"
    disabled={!customized}
    onclick={reset}
  >
    {@html iconRevert}
  </Button>
</div>

<style lang="sass">
  .colors
    display: flex
    align-items: flex-end
    gap: var(--tint-size-12)
    margin-block-start: var(--tint-size-12)

  // Both pickers share the row, and the reset button keeps its own width.
  .picker
    flex: 1
    min-inline-size: 0
</style>
