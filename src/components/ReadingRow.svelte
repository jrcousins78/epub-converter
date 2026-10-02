<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Reading } from '../lib/model';
  import { app } from '../lib/app.svelte';
  import { delight } from '../lib/delight.svelte';
  import { pageRange } from '../lib/epub/render';
  import CheckMark from './CheckMark.svelte';
  import Doodle from './Doodle.svelte';
  import { icons } from './icons';

  let {
    reading,
    index,
    total,
    selecting,
  }: {
    reading: Reading;
    index: number;
    total: number;
    selecting: boolean;
  } = $props();

  let rowEl: HTMLDivElement;

  const selected = $derived(app.selected.has(reading.id));
  const celebration = $derived(delight.celebrations[reading.id]);
  const kind = $derived(
    reading.fileType === 'pdf' ? 'PDF' : reading.fileType === 'docx' ? 'Word' : reading.fileName.endsWith('photos') ? 'Photos' : 'Photo',
  );
  const lowConf = $derived(reading.pages.filter((p) => p.confidence !== undefined && p.confidence < 70).length);
  const meta = $derived(
    [
      kind,
      reading.status === 'done' && reading.fileType !== 'docx'
        ? `${reading.pages.length} page${reading.pages.length === 1 ? '' : 's'}`
        : '',
      reading.status === 'done' ? pageRange(reading) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  // Now and then, a bookworm inches along the progress bar instead of the dot.
  const worm = $derived(delight.playful && [...reading.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 5 === 0);

  // A small "nope" shake when a reading fails.
  $effect(() => {
    const n = delight.shakes[reading.id];
    if (!n || !rowEl || delight.reducedMotion) return;
    rowEl.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 380, easing: 'ease-out' },
    );
  });
</script>

<div class="row" class:error={reading.status === 'error'} class:selected class:selecting bind:this={rowEl}>
  <span class="lead">
    <span class="grip" title="Drag to reorder">{@html icons.grip}</span>
    <input
      type="checkbox"
      class="pick"
      checked={selected}
      aria-label="Select {reading.title}"
      onclick={(e) => app.toggleSelect(reading.id, e.shiftKey)}
      data-testid="select"
    />
  </span>
  <div class="body">
    <input
      class="field title"
      value={reading.title}
      aria-label="Reading title"
      onchange={(e) => app.update(reading.id, { title: (e.target as HTMLInputElement).value.trim() || reading.title })}
    />
    <div class="meta">
      <input
        class="field course"
        value={reading.course}
        placeholder="Course"
        aria-label="Course"
        onchange={(e) => app.update(reading.id, { course: (e.target as HTMLInputElement).value.trim() })}
      />
      <span class="muted">{meta}</span>
      {#if reading.status === 'queued'}
        <span class="status muted">Waiting</span>
      {:else if reading.status === 'processing'}
        <span class="status muted">{reading.message ?? 'Working'}</span>
      {:else if reading.status === 'error'}
        <span class="status err">{reading.message}</span>
      {:else if lowConf}
        <button class="chip" onclick={() => (app.reviewing = reading.id)}>{lowConf} page{lowConf > 1 ? 's' : ''} to check</button>
      {/if}
    </div>
    {#if reading.status === 'processing'}
      <div class="bar" role="progressbar" aria-valuenow={Math.round(reading.progress * 100)} aria-valuemin="0" aria-valuemax="100">
        <span class="fill" style:width="{Math.max(3, reading.progress * 100)}%">
          {#if worm}
            <svg class="worm" viewBox="0 0 20 10" width="20" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
              <path d="M1 7.5c1.6-3.4 3.4-3.4 5 0s3.4 3.4 5 0" />
              <circle cx="14.6" cy="5.6" r="2.1" />
              <circle cx="15.2" cy="5.1" r="0.45" fill="currentColor" stroke="none" />
            </svg>
          {:else}
            <span class="head" aria-hidden="true"></span>
          {/if}
        </span>
      </div>
    {/if}
  </div>
  <div class="actions">
    {#if celebration}
      <span class="mark" in:fade={{ duration: 120 }} out:fade={{ duration: 300 }} data-testid="done-mark">
        {#if celebration === 'check'}
          <CheckMark size={18} />
        {:else}
          <Doodle name={celebration} size={24} />
        {/if}
      </span>
    {/if}
    {#if reading.status === 'done'}
      <button class="btn small" onclick={() => (app.reviewing = reading.id)}>Review</button>
    {:else if reading.status === 'error'}
      <button class="btn small" onclick={() => app.retry(reading.id)}>Try again</button>
    {/if}
    <span class="order">
      <button class="icon-btn" aria-label="Move up" disabled={index === 0} onclick={() => app.move(index, index - 1)}>{@html icons.up}</button>
      <button class="icon-btn" aria-label="Move down" disabled={index === total - 1} onclick={() => app.move(index, index + 1)}
        >{@html icons.down}</button
      >
    </span>
    <button class="icon-btn" aria-label="Remove reading" onclick={() => app.remove(reading.id)}>{@html icons.close}</button>
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 0.5rem;
    padding: 0.75rem 0.25rem 0.75rem 0;
    border-radius: 8px;
    transition: background 0.15s;
  }
  .row.selected {
    background: var(--accent-soft);
  }
  .lead {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    height: 1.9rem;
  }
  .grip {
    display: inline-grid;
    color: var(--faint);
    cursor: grab;
  }
  .grip:active {
    cursor: grabbing;
  }
  .grip :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .pick {
    appearance: none;
    flex: none;
    width: 1rem;
    height: 1rem;
    margin: 0;
    border: 1.5px solid var(--faint);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.15s,
      transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
      background 0.15s,
      border-color 0.15s;
  }
  .pick:checked {
    background: var(--accent) url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4 8.4l2.6 2.5L12 5.4" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') center / 100% no-repeat;
    border-color: var(--accent);
    transform: scale(1.08);
  }
  .pick:active {
    transform: scale(0.85);
  }
  /* The checkbox shows on hover, keyboard focus, while selecting, and always on touch screens. */
  .row:hover .pick,
  .pick:focus-visible,
  .selecting .pick {
    opacity: 1;
  }
  @media (hover: none) {
    .pick {
      opacity: 1;
    }
    .grip {
      display: none;
    }
  }
  .body {
    min-width: 0;
  }
  .title {
    font-weight: 500;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    font-size: 0.85rem;
  }
  .course {
    width: 9rem;
    color: var(--muted);
    flex: none;
  }
  .status.err {
    color: var(--danger);
  }
  .chip {
    border: 0;
    border-radius: 999px;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 0.8rem;
    padding: 0.1em 0.7em;
  }
  .bar {
    height: 3px;
    margin: 0.55rem 1.5rem 0.2rem 0;
    background: var(--line);
    border-radius: 2px;
  }
  .fill {
    position: relative;
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  /* A pulsing dot at the head of the bar: "still working". */
  .head {
    position: absolute;
    right: -4px;
    top: -2.5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .head::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1.5px solid var(--accent);
    animation: halo 1.4s ease-out infinite;
  }
  @keyframes halo {
    from {
      transform: scale(1);
      opacity: 0.8;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  .worm {
    position: absolute;
    right: -17px;
    top: -9px;
    color: var(--accent);
    transform-origin: left bottom;
    animation: inch 0.9s ease-in-out infinite;
  }
  @keyframes inch {
    0%,
    100% {
      transform: scaleX(1);
    }
    50% {
      transform: scaleX(0.82) translateY(-1px);
    }
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    margin-right: 0.35rem;
  }
  .order {
    display: inline-flex;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .row:hover .order,
  .row:focus-within .order {
    opacity: 1;
  }
  .icon-btn:disabled {
    visibility: hidden;
  }
  .small {
    padding: 0.25em 0.8em;
    font-size: 0.8rem;
  }
  @media (max-width: 560px) {
    .order {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .head::after,
    .worm {
      animation: none;
    }
  }
</style>
