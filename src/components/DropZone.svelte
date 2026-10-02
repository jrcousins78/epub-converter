<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { icons } from './icons';

  let { compact = false }: { compact?: boolean } = $props();
  let input: HTMLInputElement;
  let over = $state(false);

  function pick(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (files.length) void app.addFiles(files);
    input.value = '';
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    over = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void app.addFiles(files);
  }
</script>

<label
  class="drop"
  class:over
  class:compact
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      over = true;
    }
  }}
  ondragleave={() => (over = false)}
  ondrop={drop}
>
  <input
    bind:this={input}
    class="sr-only"
    type="file"
    multiple
    accept=".pdf,.docx,image/*,.heic,.heif"
    onchange={pick}
    data-testid="file-input"
  />
  <span class="ico">{@html icons.upload}</span>
  {#if compact}
    <span>Add more readings</span>
  {:else}
    <span class="main">Drop your readings here</span>
    <span class="sub">PDFs, scans, phone photos or Word files — or <u>browse</u></span>
  {/if}
</label>

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 2.6rem 1rem;
    border: 1.5px dashed var(--line);
    border-radius: var(--radius);
    color: var(--muted);
    text-align: center;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .drop:hover,
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--fg);
  }
  .drop:focus-within {
    border-color: var(--accent);
  }
  .compact {
    flex-direction: row;
    justify-content: center;
    padding: 0.8rem 1rem;
    font-size: 0.9rem;
  }
  .ico :global(svg) {
    width: 1.4rem;
    height: 1.4rem;
  }
  .compact .ico :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .main {
    color: var(--fg);
    font-weight: 500;
  }
  .sub {
    font-size: 0.875rem;
  }
</style>
