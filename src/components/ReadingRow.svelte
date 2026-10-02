<script lang="ts">
  import type { Reading } from '../lib/model';
  import { app } from '../lib/app.svelte';
  import { pageRange } from '../lib/epub/render';
  import { icons } from './icons';

  let {
    reading,
    index,
    total,
    ondragstart,
    ondragover,
    ondrop,
  }: {
    reading: Reading;
    index: number;
    total: number;
    ondragstart: (e: DragEvent) => void;
    ondragover: (e: DragEvent) => void;
    ondrop: (e: DragEvent) => void;
  } = $props();

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
</script>

<li class="row" class:error={reading.status === 'error'} draggable="true" {ondragstart} {ondragover} {ondrop} data-testid="reading">
  <span class="grip" title="Drag to reorder">{@html icons.grip}</span>
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
        <span style:width="{Math.max(3, reading.progress * 100)}%"></span>
      </div>
    {/if}
  </div>
  <div class="actions">
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
</li>

<style>
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 0.5rem;
    padding: 0.75rem 0.25rem 0.75rem 0;
    border-bottom: 1px solid var(--line);
  }
  .grip {
    color: var(--faint);
    cursor: grab;
    padding-top: 0.35rem;
  }
  .grip :global(svg) {
    width: 1rem;
    height: 1rem;
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
    margin-top: 0.4rem;
    background: var(--line);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
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
</style>
