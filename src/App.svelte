<script lang="ts">
  import { onMount } from 'svelte';
  import { app, formatBytes } from './lib/app.svelte';
  import DropZone from './components/DropZone.svelte';
  import ReadingRow from './components/ReadingRow.svelte';
  import Settings from './components/Settings.svelte';
  import Review from './components/Review.svelte';
  import { icons } from './components/icons';

  let settingsOpen = $state(false);
  let dragFrom = $state<number | undefined>(undefined);
  let pageDrag = $state(false);

  onMount(() => {
    void app.init();
  });

  const counts = $derived(app.counts);
  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (counts.total) parts.push(`${counts.done} of ${counts.total} ready`);
    if (counts.waiting) parts.push(`${counts.waiting} in progress`);
    if (counts.failed) parts.push(`${counts.failed} need attention`);
    if (app.estimate && counts.done) parts.push(`about ${formatBytes(app.estimate)}`);
    return parts.join(' · ');
  });

  function rowDragStart(i: number, e: DragEvent) {
    dragFrom = i;
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function rowDrop(i: number, e: DragEvent) {
    if (dragFrom === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    app.move(dragFrom, i);
    dragFrom = undefined;
  }

  // Files dropped anywhere on the page are added too.
  function pageDrop(e: DragEvent) {
    pageDrag = false;
    if (dragFrom !== undefined || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    void app.addFiles(Array.from(e.dataTransfer.files));
  }
</script>

<svelte:window
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      pageDrag = true;
    }
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) pageDrag = false;
  }}
  ondrop={pageDrop}
/>

<div class="app" class:page-drag={pageDrag}>
  <header class="top">
    <span class="brand">EPUB Converter</span>
    <button class="icon-btn" aria-label="Settings" onclick={() => (settingsOpen = true)}>{@html icons.settings}</button>
  </header>

  <main>
    <section class="book">
      <input
        class="field book-title"
        value={app.bundle.settings.title}
        placeholder="Week 5 readings"
        aria-label="Book title"
        onchange={(e) => app.updateSettings({ title: (e.target as HTMLInputElement).value.trim() || 'Weekly readings' })}
      />
      <input
        class="field book-author"
        value={app.bundle.settings.author}
        placeholder="Course or term, shown as the author on your e-reader"
        aria-label="Book author"
        onchange={(e) => app.updateSettings({ author: (e.target as HTMLInputElement).value.trim() })}
      />
    </section>

    {#if app.loaded}
      {#if app.readings.length}
        <ol class="readings" aria-label="Readings">
          {#each app.readings as r, i (r.id)}
            <ReadingRow
              reading={r}
              index={i}
              total={app.readings.length}
              ondragstart={(e) => rowDragStart(i, e)}
              ondragover={(e) => {
                if (dragFrom !== undefined) e.preventDefault();
              }}
              ondrop={(e) => rowDrop(i, e)}
            />
          {/each}
        </ol>
        <DropZone compact />
      {:else}
        <DropZone />
        <ul class="intro muted">
          <li>Add all of the week's readings: text PDFs, scanned PDFs, photos of book pages, or Word files.</li>
          <li>Photos you add together become one reading. Two-page spreads are split automatically.</li>
          <li>You get one EPUB with a table of contents entry for each reading, and the original page numbers for citing.</li>
          <li>Everything stays on this device. Nothing is uploaded.</li>
        </ul>
      {/if}
    {/if}
  </main>

  {#if app.readings.length}
    <footer class="bar">
      <div class="inner">
        <span class="summary muted" data-testid="summary">{summary}</span>
        <button class="btn primary" disabled={!counts.done || app.building} onclick={() => app.build()} data-testid="build">
          {app.building ? 'Building…' : 'Build EPUB'}
        </button>
      </div>
    </footer>
  {/if}

  {#if app.notice}
    <div class="toast" role="status">{app.notice}</div>
  {/if}
</div>

{#if settingsOpen}
  <Settings onclose={() => (settingsOpen = false)} />
{/if}

{#if app.reviewing}
  <Review id={app.reviewing} />
{/if}

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem 1.25rem 0;
  }
  .brand {
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  main {
    flex: 1;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 7rem;
  }
  .book {
    margin-bottom: 1.75rem;
  }
  .book-title {
    font-size: 2rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .book-author {
    color: var(--muted);
    margin-top: 0.15rem;
  }
  .readings {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .intro {
    margin: 1.75rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    display: grid;
    gap: 0.4rem;
  }
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--bg) 90%, transparent);
    backdrop-filter: blur(8px);
    border-top: 1px solid var(--line);
    z-index: 10;
  }
  .bar .inner {
    max-width: 760px;
    margin: 0 auto;
    padding: 0.75rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .summary {
    font-size: 0.875rem;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 5.5rem;
    transform: translateX(-50%);
    max-width: min(92vw, 560px);
    background: var(--fg);
    color: var(--bg);
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.875rem;
    z-index: 50;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.15);
  }
  .page-drag main {
    outline: 2px dashed var(--accent);
    outline-offset: -0.5rem;
    border-radius: var(--radius);
  }
</style>
