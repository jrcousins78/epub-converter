<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { delight } from '../lib/delight.svelte';
  import { icons } from './icons';

  let { compact = false }: { compact?: boolean } = $props();
  let input: HTMLInputElement;
  let zone: HTMLLabelElement;
  let over = $state(false);
  let gulp = $state(0);
  let ripples = $state<{ id: number; x: number; y: number }[]>([]);
  let rid = 0;

  function ripple(x?: number, y?: number) {
    if (!delight.playful || !zone) return;
    const r = zone.getBoundingClientRect();
    const id = ++rid;
    ripples.push({ id, x: x !== undefined ? x - r.left : r.width / 2, y: y !== undefined ? y - r.top : r.height / 2 });
    gulp++;
    setTimeout(() => (ripples = ripples.filter((p) => p.id !== id)), 800);
  }

  function pick(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (files.length) {
      ripple();
      void app.addFiles(files);
    }
    input.value = '';
  }

  function drop(e: DragEvent) {
    // Handled here; stop the page-wide drop handler from adding the same files again.
    e.preventDefault();
    e.stopPropagation();
    over = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) {
      ripple(e.clientX, e.clientY);
      void app.addFiles(files);
    }
  }
</script>

<label
  bind:this={zone}
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
  data-testid="drop-zone"
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
  {#key gulp}
    <span class="ico" class:gulp={gulp > 0}>{@html icons.upload}</span>
  {/key}
  {#if compact}
    <span>Add more readings</span>
  {:else}
    <span class="main">Drop your readings here</span>
    <span class="sub">PDFs, scans, phone photos or Word files — or <u>browse</u></span>
  {/if}
  {#each ripples as r (r.id)}
    <span class="ripple" style:left="{r.x}px" style:top="{r.y}px" aria-hidden="true"></span>
  {/each}
</label>

<style>
  .drop {
    position: relative;
    overflow: hidden;
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
      background 0.15s,
      transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .drop:hover,
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--fg);
  }
  .drop.over {
    transform: scale(1.01);
  }
  .drop:active {
    transform: scale(0.99);
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
  .ico {
    display: inline-grid;
  }
  .ico :global(svg) {
    width: 1.4rem;
    height: 1.4rem;
  }
  .compact .ico :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .over .ico {
    animation: hover-bob 0.9s ease-in-out infinite;
  }
  .ico.gulp {
    animation: gulp 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
    color: var(--accent);
  }
  .main {
    color: var(--fg);
    font-weight: 500;
  }
  .sub {
    font-size: 0.875rem;
  }
  .ripple {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    border: 1.5px solid var(--accent);
    pointer-events: none;
    animation: ripple 0.75s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes ripple {
    from {
      opacity: 0.9;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(14);
    }
  }
  @keyframes gulp {
    35% {
      transform: scale(0.7) translateY(2px);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes hover-bob {
    50% {
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ripple,
    .ico {
      animation: none !important;
    }
    .drop {
      transition: none;
    }
  }
</style>
