<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteURLSearchParams } from 'svelte/reactivity'
  import SearchField from 'tint/components/SearchField.svelte'

  import { applyFilter } from '@src/lib/match.ts'

  interface Props {
    total: number
    noun: string
  }

  let { total, noun }: Props = $props()

  // Reading the query string here rather than in the initializer keeps the first
  // client render identical to what Astro produced, so Svelte hydrates the
  // existing input instead of replacing it.
  let value = $state('')
  let visible = $state(total)
  let mounted = $state(false)

  onMount(() => {
    mounted = true
    value = new URLSearchParams(window.location.search).get('q') ?? ''
  })

  function filter(query: string) {
    const grid = document.querySelector('[data-asset-grid]')
    if (!grid) {
      return
    }
    visible = applyFilter(grid, query)
    document
      .querySelector('[data-empty-state]')
      ?.toggleAttribute('hidden', visible > 0)

    const params = new SvelteURLSearchParams(window.location.search)
    if (query.trim()) {
      params.set('q', query.trim())
    } else {
      params.delete('q')
    }
    const search = params.toString()
    // The fragment names the tile whose panel is open, so it has to survive a
    // keystroke here or typing would drop it from a copyable URL.
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    )
  }

  $effect(() => {
    if (mounted) {
      filter(value)
    }
  })
</script>

<div class="search">
  <SearchField
    id="asset-search"
    bind:value
    label="Search assets"
    filledBackdrop
  />
  <p aria-live="polite" class="tint--visually-hidden">
    Showing {visible} of {total}
    {noun}
  </p>
</div>

<style lang="sass">
  .search
    inline-size: 100%
    max-inline-size: 320px
</style>
