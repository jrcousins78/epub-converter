<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { pageLabel, type Block, type Reading } from '../lib/model';
  import { fromEditable, renumberPages, toEditable } from '../lib/edit';
  import { pageRange } from '../lib/epub/render';
  import Thumb from './Thumb.svelte';
  import { icons } from './icons';

  let { id }: { id: string } = $props();
  const reading = $derived(app.find(id));
  let enlarged = $state<string | undefined>(undefined);
  let onlyLow = $state(false);

  type Group = { page: number | undefined; items: { block: Block; index: number }[] };
  const groups = $derived.by(() => {
    const r = reading;
    if (!r) return [] as Group[];
    const byPage = new Map<number | undefined, Group>();
    if (r.fileType !== 'docx') r.pages.forEach((_, i) => byPage.set(i, { page: i, items: [] }));
    r.blocks.forEach((block, index) => {
      const key = r.fileType === 'docx' ? undefined : block.page;
      if (!byPage.has(key)) byPage.set(key, { page: key, items: [] });
      byPage.get(key)!.items.push({ block, index });
    });
    return [...byPage.values()]
      .sort((a, b) => (a.page ?? -1) - (b.page ?? -1))
      .filter((g) => !onlyLow || (g.page !== undefined && (r.pages[g.page]?.confidence ?? 100) < 70));
  });

  const isLow = (r: Reading, p: number | undefined) => p !== undefined && r.pages[p]?.confidence !== undefined && r.pages[p].confidence! < 70;

  function kindValue(b: Block): string {
    if (b.kind === 'heading') return `h${b.level}`;
    if (b.kind === 'paragraph') return b.style === 'quote' ? 'quote' : 'p';
    return b.kind;
  }

  function setKind(index: number, value: string) {
    const r = reading!;
    const blocks = [...r.blocks];
    const b = blocks[index];
    if (value === 'remove') {
      blocks.splice(index, 1);
    } else if (b.kind === 'heading' || b.kind === 'paragraph') {
      const content = b.content;
      if (value.startsWith('h')) blocks[index] = { kind: 'heading', level: Number(value[1]) as 1 | 2 | 3, content, page: b.page };
      else blocks[index] = { kind: 'paragraph', content, page: b.page, ...(value === 'quote' ? { style: 'quote' as const } : {}) };
    }
    app.updateBlocks(r.id, blocks);
  }

  function setText(index: number, text: string) {
    const r = reading!;
    const blocks = [...r.blocks];
    const b = blocks[index];
    if (b.kind !== 'heading' && b.kind !== 'paragraph') return;
    blocks[index] = { ...b, content: fromEditable(text, b.content, r) };
    app.updateBlocks(r.id, blocks);
  }

  function setCaption(index: number, caption: string) {
    const r = reading!;
    const blocks = [...r.blocks];
    const b = blocks[index];
    if (b.kind !== 'figure') return;
    blocks[index] = { ...b, caption: caption.trim() || undefined };
    app.updateBlocks(r.id, blocks);
  }

  function setNote(noteId: string, text: string) {
    const r = reading!;
    app.update(r.id, {
      notes: r.notes.map((n) => (n.id === noteId ? { ...n, content: fromEditable(text, n.content, r) } : n)),
    });
  }

  function renumber(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(v) || v < 1) return;
    app.update(reading!.id, { pages: renumberPages(reading!, v) });
  }

  function autosize(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight + 2}px`;
    };
    fit();
    node.addEventListener('input', fit);
    return { destroy: () => node.removeEventListener('input', fit) };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (enlarged ? (enlarged = undefined) : (app.reviewing = undefined))} />

{#if reading}
  <div class="review" role="dialog" aria-modal="true" aria-label="Review {reading.title}">
    <header class="top">
      <button class="btn" onclick={() => (app.reviewing = undefined)}>{@html icons.back} Done</button>
      <span class="muted saved">Changes are saved automatically</span>
    </header>

    <div class="wrap">
      <section class="details">
        <input class="field big" value={reading.title} aria-label="Title" onchange={(e) => app.update(reading.id, { title: (e.target as HTMLInputElement).value.trim() || reading.title })} />
        <div class="grid">
          <label>Author <input class="field" value={reading.author} placeholder="e.g. C. Wright Mills" onchange={(e) => app.update(reading.id, { author: (e.target as HTMLInputElement).value.trim() })} /></label>
          <label>Course <input class="field" value={reading.course} placeholder="e.g. SOC 101" onchange={(e) => app.update(reading.id, { course: (e.target as HTMLInputElement).value.trim() })} /></label>
          {#if reading.fileType !== 'docx'}
            <label
              >First page number
              <input
                class="field"
                type="number"
                min="1"
                placeholder={pageLabel(reading, 0)}
                value={/^\d+$/.test(reading.pages[0]?.label ?? '') ? reading.pages[0].label : ''}
                onchange={renumber}
              />
            </label>
            <span class="muted range">{pageRange(reading) || `${reading.pages.length} pages, no printed page numbers found`}</span>
          {/if}
        </div>
        {#if reading.fileType === 'image' || reading.pages.some((p) => p.source === 'ocr')}
          <div class="tools">
            <span class="muted">Text recognition:</span>
            <button class="btn small" onclick={() => { app.retry(reading.id, -1); app.reviewing = undefined; }}>{@html icons.rotateLeft} Rotate left &amp; redo</button>
            <button class="btn small" onclick={() => { app.retry(reading.id, 1); app.reviewing = undefined; }}>{@html icons.rotateRight} Rotate right &amp; redo</button>
            <button class="btn small" onclick={() => { app.retry(reading.id); app.reviewing = undefined; }}>{@html icons.redo} Redo</button>
            {#if reading.pages.some((p) => p.confidence !== undefined && p.confidence < 70)}
              <label class="only-low"><input type="checkbox" bind:checked={onlyLow} /> Only pages to check</label>
            {/if}
          </div>
        {/if}
        <p class="hint muted">
          Edit text directly. Use the menu to mark headings or remove junk. Keep <code>⟦p. 47⟧</code> and <code>⟦note 1⟧</code> markers to keep page numbers and note links.
        </p>
      </section>

      {#each groups as g (g.page ?? 'all')}
        <section class="page" class:low={isLow(reading, g.page)}>
          {#if g.page !== undefined}
            <div class="page-head">
              <span class="label">Page {pageLabel(reading, g.page)}</span>
              {#if reading.pages[g.page]?.confidence !== undefined}
                <span class="conf" class:bad={isLow(reading, g.page)}
                  >{isLow(reading, g.page) ? 'Check this page' : 'Recognised'} · {reading.pages[g.page].confidence}%</span
                >
              {/if}
            </div>
          {/if}
          <div class="page-body" class:has-preview={g.page !== undefined && reading.pages[g.page]?.preview}>
            {#if g.page !== undefined && reading.pages[g.page]?.preview}
              {@const pv = reading.pages[g.page].preview!}
              <div class="preview"><Thumb id={pv} alt="Original page" onclick={() => (enlarged = pv)} /></div>
            {/if}
            <div class="blocks">
              {#each g.items as { block, index } (index)}
                <div class="block">
                  {#if block.kind === 'heading' || block.kind === 'paragraph'}
                    <select value={kindValue(block)} aria-label="Block type" onchange={(e) => setKind(index, (e.target as HTMLSelectElement).value)}>
                      <option value="p">Paragraph</option>
                      <option value="quote">Quotation</option>
                      <option value="h1">Heading</option>
                      <option value="h2">Section</option>
                      <option value="h3">Subsection</option>
                      <option value="remove">Remove</option>
                    </select>
                    <textarea
                      class:heading={block.kind === 'heading'}
                      use:autosize
                      value={toEditable(block.content, reading)}
                      onchange={(e) => setText(index, (e.target as HTMLTextAreaElement).value)}
                    ></textarea>
                  {:else if block.kind === 'figure'}
                    <button class="btn small" onclick={() => setKind(index, 'remove')}>Remove</button>
                    <div class="figure">
                      <Thumb id={block.image} alt={block.caption ?? 'Figure'} onclick={() => (enlarged = block.image)} />
                      <input class="field" value={block.caption ?? ''} placeholder="Caption" onchange={(e) => setCaption(index, (e.target as HTMLInputElement).value)} />
                    </div>
                  {:else}
                    <button class="btn small" onclick={() => setKind(index, 'remove')}>Remove</button>
                    <span class="muted">{block.kind === 'list' ? `List (${block.items.length} items)` : `Table (${block.rows.length} rows)`}</span>
                  {/if}
                </div>
              {:else}
                <p class="muted empty">No text on this page.</p>
              {/each}
            </div>
          </div>
        </section>
      {/each}

      {#if reading.notes.length}
        <section class="page">
          <div class="page-head"><span class="label">Notes</span></div>
          <div class="blocks">
            {#each reading.notes as n (n.id)}
              <div class="block">
                <span class="marker">{n.marker}</span>
                <textarea use:autosize value={toEditable(n.content, reading)} onchange={(e) => setNote(n.id, (e.target as HTMLTextAreaElement).value)}></textarea>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>

  {#if enlarged}
    <button class="lightbox" onclick={() => (enlarged = undefined)} aria-label="Close preview">
      <span><Thumb id={enlarged} /></span>
    </button>
  {/if}
{/if}

<style>
  .review {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: var(--bg);
    overflow-y: auto;
  }
  .top {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.25rem;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
  }
  .top :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  .saved {
    font-size: 0.8rem;
  }
  .wrap {
    max-width: 980px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 4rem;
  }
  .big {
    font-size: 1.5rem;
    font-weight: 600;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    align-items: end;
    margin: 0.5rem 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .grid label {
    display: flex;
    flex-direction: column;
    min-width: 10rem;
  }
  .grid .field {
    color: var(--fg);
    font-size: 0.95rem;
  }
  .range {
    font-size: 0.85rem;
    padding-bottom: 0.2rem;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    margin: 0.75rem 0;
    font-size: 0.85rem;
  }
  .tools :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }
  .only-low {
    margin-left: auto;
  }
  .small {
    padding: 0.25em 0.8em;
    font-size: 0.8rem;
  }
  .hint {
    font-size: 0.85rem;
  }
  code {
    font-size: 0.85em;
    background: var(--hover);
    border-radius: 4px;
    padding: 0 0.25em;
  }
  .page {
    border-top: 1px solid var(--line);
    padding: 1.25rem 0;
  }
  .page-head {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    margin-bottom: 0.75rem;
  }
  .label {
    font-weight: 600;
  }
  .conf {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .conf.bad {
    color: var(--warn);
  }
  .page-body.has-preview {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    gap: 1.25rem;
    align-items: start;
  }
  .preview {
    position: sticky;
    top: 4.5rem;
  }
  .blocks {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .block {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 0.5rem;
    align-items: start;
  }
  .block select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    font-size: 0.8rem;
    padding: 0.3em;
  }
  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    padding: 0.45em 0.6em;
    line-height: 1.45;
    font-size: 0.92rem;
    font-family: Georgia, 'Times New Roman', serif;
  }
  textarea.heading {
    font-weight: 700;
    font-family: var(--font);
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .marker {
    text-align: right;
    color: var(--muted);
    padding-top: 0.4em;
  }
  .figure {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 22rem;
  }
  .empty {
    font-size: 0.85rem;
  }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: 0;
    padding: 2rem;
    background: rgb(0 0 0 / 0.75);
    display: grid;
    place-items: center;
    cursor: zoom-out;
  }
  .lightbox span {
    display: block;
    width: min(900px, 100%);
    max-height: 100%;
    overflow: auto;
  }
  @media (max-width: 720px) {
    .page-body.has-preview {
      grid-template-columns: 1fr;
    }
    .preview {
      position: static;
      max-width: 18rem;
    }
    .block {
      grid-template-columns: 1fr;
    }
  }
</style>
