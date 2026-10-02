<script lang="ts">
  import { fly } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { app } from '../lib/app.svelte';
  import { safeFileBase } from '../lib/epub/build';

  let { onsave, oncancel }: { onsave: (name: string) => void; oncancel: () => void } = $props();
  let name = $state(app.suggestedFileName);
  const valid = $derived(safeFileBase(name).length > 0);

  function focus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function submit(e: Event) {
    e.preventDefault();
    if (valid) onsave(name);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && oncancel()} />

<div class="scrim" role="presentation" onclick={oncancel}></div>
<div
  class="dialog"
  role="dialog"
  aria-modal="true"
  aria-labelledby="save-title"
  in:fly={{ y: 12, duration: 280, easing: backOut }}
  out:fly={{ y: 8, duration: 150 }}
>
<form onsubmit={submit}>
  <h2 id="save-title">Save your book</h2>
  <label class="name">
    <span class="sr-only">File name</span>
    <input use:focus bind:value={name} spellcheck="false" autocomplete="off" data-testid="file-name" />
    <span class="ext">{app.fileExtension}</span>
  </label>
  <p class="hint muted">
    {app.counts.done} reading{app.counts.done === 1 ? '' : 's'}{app.counts.waiting
      ? ` · ${app.counts.waiting} still in progress will be left out`
      : ''}
  </p>
  <div class="buttons">
    <button type="button" class="btn" onclick={oncancel}>Cancel</button>
    <button type="submit" class="btn primary" disabled={!valid} data-testid="save">Save EPUB</button>
  </div>
</form>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.2);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    left: 50%;
    bottom: 5.5rem;
    translate: -50% 0;
    z-index: 41;
    width: min(92vw, 440px);
    padding: 1.1rem 1.2rem 1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.12);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }
  .name {
    display: flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    padding: 0 0.6rem;
    transition: border-color 0.15s;
  }
  .name:focus-within {
    border-color: var(--accent);
  }
  .name input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 0.55em 0;
    outline: none;
  }
  .ext {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .hint {
    font-size: 0.8rem;
    margin: 0.5rem 0 0.9rem;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
