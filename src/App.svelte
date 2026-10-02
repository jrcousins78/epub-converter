<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fly, slide } from 'svelte/transition';
  import { backOut, cubicOut } from 'svelte/easing';
  import { app, formatBytes } from './lib/app.svelte';
  import { delight } from './lib/delight.svelte';
  import DropZone from './components/DropZone.svelte';
  import ReadingRow from './components/ReadingRow.svelte';
  import Settings from './components/Settings.svelte';
  import Review from './components/Review.svelte';
  import SaveDialog from './components/SaveDialog.svelte';
  import Effects from './components/Effects.svelte';
  import { icons } from './components/icons';

  let settingsOpen = $state(false);
  let saving = $state(false);
  let confirmReset = $state(false);
  let dragFrom = $state<number | undefined>(undefined);
  let dragOver = $state<number | undefined>(undefined);
  /** Rows only become draggable while the grip handle is pressed, so text in them stays selectable. */
  let armed = $state<string | undefined>(undefined);
  let settled = $state<string | undefined>(undefined);
  let pageDrag = $state(false);
  let courseDraft = $state('');
  let buildBtn = $state<HTMLButtonElement | undefined>(undefined);
  let pulse = $state(false);

  onMount(() => {
    void app.init();
  });

  const counts = $derived(app.counts);
  const selecting = $derived(app.selected.size > 0);
  const dupes = $derived(app.duplicates);
  const motion = $derived(delight.reducedMotion ? 0 : 1);
  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (counts.total) parts.push(`${counts.done} of ${counts.total} ready`);
    if (counts.waiting) parts.push(`${counts.waiting} in progress`);
    if (counts.failed) parts.push(`${counts.failed} need attention`);
    if (app.estimate && counts.done) parts.push(`about ${formatBytes(app.estimate)}`);
    return parts.join(' · ');
  });

  // When everything has finished, the build button pulses once.
  $effect(() => {
    if (!delight.readyPulse) return;
    pulse = false;
    void tick().then(() => (pulse = true));
    const t = setTimeout(() => (pulse = false), 1200);
    return () => clearTimeout(t);
  });

  function rowDragStart(i: number, e: DragEvent) {
    dragFrom = i;
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // Lift the row before the browser takes its drag snapshot.
    const el = e.currentTarget as HTMLElement;
    el.classList.add('lifting');
    requestAnimationFrame(() => el.classList.remove('lifting'));
  }

  function rowDrop(i: number, e: DragEvent) {
    if (dragFrom === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const id = app.readings[dragFrom]?.id;
    app.move(dragFrom, i);
    dragFrom = dragOver = armed = undefined;
    settled = id;
    delight.tap('light');
    setTimeout(() => (settled = undefined), 500);
  }

  // Files dropped anywhere else on the page are added too (the drop zone handles its own).
  function pageDrop(e: DragEvent) {
    pageDrag = false;
    if (e.defaultPrevented || dragFrom !== undefined || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    void app.addFiles(Array.from(e.dataTransfer.files));
  }

  async function save(name: string) {
    saving = false;
    const ok = await app.build(name);
    if (ok && buildBtn) {
      const r = buildBtn.getBoundingClientRect();
      delight.built({ x: r.left + r.width / 2, y: r.top });
    }
  }

  async function startOver() {
    confirmReset = false;
    await app.startOver();
  }

  function applyCourse() {
    app.setCourse([...app.selected], courseDraft.trim());
    courseDraft = '';
    delight.tap('light');
  }

  function typing(t: EventTarget | null) {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function keydown(e: KeyboardEvent) {
    if (app.reviewing || settingsOpen || saving) return;
    if (e.key === 'Escape' && selecting) app.clearSelection();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selecting && !typing(e.target)) {
      e.preventDefault();
      app.remove([...app.selected]);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && app.readings.length && !typing(e.target)) {
      e.preventDefault();
      app.selectAll();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && app.notice?.action && !typing(e.target)) {
      e.preventDefault();
      app.notice.action.run();
    }
  }
</script>

<svelte:window
  onkeydown={keydown}
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      pageDrag = true;
    }
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) pageDrag = false;
  }}
  ondragend={() => (pageDrag = false)}
  ondrop={pageDrop}
/>

<div class="app" class:page-drag={pageDrag}>
  <header class="top">
    <span class="brand">EPUB Converter</span>
    <button class="icon-btn spin" aria-label="Settings" onclick={() => (settingsOpen = true)}>{@html icons.settings}</button>
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
        <div class="list-head">
          <label class="all">
            <input
              type="checkbox"
              class="pick"
              checked={app.selected.size === app.readings.length}
              indeterminate={selecting && app.selected.size < app.readings.length}
              onchange={(e) => app.selectAll((e.target as HTMLInputElement).checked)}
              aria-label="Select all readings"
              data-testid="select-all"
            />
            <span class="muted">{app.readings.length} reading{app.readings.length === 1 ? '' : 's'}</span>
          </label>
          {#if dupes.length}
            <button class="link warn" onclick={() => app.selectDuplicates()} transition:fly={{ y: -4, duration: 200 * motion }} data-testid="select-dupes">
              {dupes.length} look{dupes.length === 1 ? 's' : ''} like duplicate{dupes.length === 1 ? '' : 's'} · Select
            </button>
          {/if}
        </div>
        <ol class="readings" aria-label="Readings">
          {#each app.readings as r, i (r.id)}
            <li
              class:drag-source={dragFrom === i}
              class:drop-before={dragOver === i && dragFrom !== undefined && dragFrom > i}
              class:drop-after={dragOver === i && dragFrom !== undefined && dragFrom < i}
              class:settled={settled === r.id}
              draggable={armed === r.id}
              onpointerdown={(e) => (armed = (e.target as HTMLElement).closest('.grip') ? r.id : undefined)}
              ondragstart={(e) => rowDragStart(i, e)}
              ondragover={(e) => {
                if (dragFrom === undefined) return;
                e.preventDefault();
                dragOver = i;
              }}
              ondragend={() => (dragFrom = dragOver = armed = undefined)}
              ondrop={(e) => rowDrop(i, e)}
              animate:flip={{ duration: 320 * motion, easing: backOut }}
              in:fly={{ y: 10, duration: 280 * motion, delay: Math.min(i, 6) * 30 * motion, easing: cubicOut }}
              out:slide={{ duration: 220 * motion }}
              data-testid="reading"
            >
              <ReadingRow reading={r} index={i} total={app.readings.length} {selecting} />
            </li>
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
      {#if selecting}
        <div class="inner" in:fly={{ y: 10, duration: 220 * motion }}>
          <span class="summary"><b>{app.selected.size}</b> selected</span>
          <div class="actions">
            <form
              class="course-set"
              onsubmit={(e) => {
                e.preventDefault();
                applyCourse();
              }}
            >
              <input bind:value={courseDraft} placeholder="Set course…" aria-label="Set course for selected readings" />
            </form>
            <button class="btn danger" onclick={() => app.remove([...app.selected])} data-testid="remove-selected">Remove</button>
            <button class="btn" onclick={() => app.clearSelection()}>Done</button>
          </div>
        </div>
      {:else}
        <div class="inner" in:fly={{ y: -10, duration: 220 * motion }}>
          <span class="summary muted" data-testid="summary">
            {#if confirmReset}
              <span class="confirm" in:fly={{ x: -6, duration: 180 * motion }}>
                Clear all {counts.total} reading{counts.total === 1 ? '' : 's'}?
                <button class="link danger" onclick={startOver} data-testid="confirm-reset">Clear</button>
                <button class="link" onclick={() => (confirmReset = false)}>Keep</button>
              </span>
            {:else if app.lastSaved}
              Saved {app.lastSaved} ·
              <button class="link" onclick={() => (confirmReset = true)} data-testid="start-over">Start over</button>
            {:else}
              {summary}
            {/if}
          </span>
          <div class="actions">
            {#if !confirmReset && !app.lastSaved}
              <button class="btn quiet" onclick={() => (confirmReset = true)} data-testid="start-over">Start over</button>
            {/if}
            <button
              bind:this={buildBtn}
              class="btn primary"
              class:pulse
              class:busy={app.building}
              disabled={!counts.done || app.building}
              onclick={() => (saving = true)}
              data-testid="build"
            >
              {#if app.building}
                Building<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              {:else}
                Build EPUB
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </footer>
  {/if}

  {#if app.notice}
    {@const n = app.notice}
    <div class="toast" role="status" in:fly={{ y: 12, duration: 260 * motion, easing: backOut }} out:fly={{ y: 6, duration: 160 * motion }}>
      <span>{n.text}</span>
      {#if n.action}
        <button class="toast-action" onclick={() => n.action?.run()} data-testid="toast-action">{n.action.label}</button>
      {/if}
    </div>
  {/if}
</div>

{#if saving}
  <SaveDialog onsave={save} oncancel={() => (saving = false)} />
{/if}

{#if settingsOpen}
  <Settings onclose={() => (settingsOpen = false)} />
{/if}

{#if app.reviewing}
  <Review id={app.reviewing} />
{/if}

<Effects />

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
  .spin :global(svg) {
    transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .spin:hover :global(svg) {
    transform: rotate(60deg);
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
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 0 0.4rem;
    font-size: 0.85rem;
    min-height: 1.9rem;
  }
  .all {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
  }
  .all .pick {
    appearance: none;
    width: 1rem;
    height: 1rem;
    margin: 0 0.25rem;
    border: 1.5px solid var(--faint);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .all .pick:checked,
  .all .pick:indeterminate {
    background: var(--accent);
    border-color: var(--accent);
  }
  .all .pick:checked {
    background: var(--accent)
      url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4 8.4l2.6 2.5L12 5.4" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')
      center / 100% no-repeat;
  }
  .all .pick:indeterminate {
    background: var(--accent)
      url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 8h7" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>')
      center / 100% no-repeat;
  }
  .all .pick:active {
    transform: scale(0.85);
  }
  .readings {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .readings > li {
    border-bottom: 1px solid var(--line);
    position: relative;
    background: var(--bg);
  }
  .readings > li:global(.lifting) {
    box-shadow: 0 10px 28px rgb(0 0 0 / 0.14);
    transform: scale(1.01);
    border-radius: 10px;
    background: var(--surface);
  }
  .readings > li.drag-source {
    opacity: 0.35;
  }
  .readings > li.drop-before::before,
  .readings > li.drop-after::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    border-radius: 2px;
    z-index: 2;
  }
  .readings > li.drop-before::before {
    top: -1px;
  }
  .readings > li.drop-after::after {
    bottom: -1px;
  }
  .readings > li.settled {
    animation: settle 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes settle {
    0% {
      transform: translateY(-4px) scale(1.01);
    }
    100% {
      transform: none;
    }
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
    min-width: 0;
  }
  .summary b {
    font-weight: 650;
  }
  .bar .inner > .summary:only-child,
  .bar .inner .summary:has(b) {
    white-space: nowrap;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .course-set input {
    width: 8.5rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    padding: 0.4em 0.9em;
    font-size: 0.85rem;
  }
  .course-set input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link.warn {
    color: var(--warn);
  }
  .link.danger,
  .btn.danger {
    color: var(--danger);
  }
  .btn.quiet {
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .btn.quiet:hover {
    color: var(--fg);
  }
  .confirm {
    color: var(--fg);
  }
  .confirm .link {
    margin-left: 0.5rem;
  }
  .btn.primary {
    position: relative;
  }
  .btn.primary.pulse::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    border: 1.5px solid var(--accent);
    animation: pulse 1s cubic-bezier(0.2, 0.7, 0.3, 1);
    pointer-events: none;
  }
  @keyframes pulse {
    from {
      opacity: 0.9;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.18, 1.45);
    }
  }
  .btn.busy {
    opacity: 1;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    margin-left: 4px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: dot 0.9s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes dot {
    0%,
    100% {
      opacity: 0.35;
      transform: translateY(0);
    }
    50% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 5.5rem;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: min(92vw, 560px);
    background: var(--fg);
    color: var(--bg);
    padding: 0.6rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    z-index: 50;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.15);
  }
  .toast-action {
    border: 0;
    background: none;
    color: inherit;
    font-weight: 700;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }
  .page-drag main {
    outline: 2px dashed var(--accent);
    outline-offset: -0.5rem;
    border-radius: var(--radius);
  }
  @media (max-width: 560px) {
    .course-set input {
      width: 5.8rem;
    }
    .bar .inner {
      gap: 0.6rem;
    }
    .btn.quiet {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .readings > li.settled,
    .btn.primary.pulse::after,
    .dots i {
      animation: none;
    }
  }
</style>
