<script lang="ts">
  import { app, formatBytes } from '../lib/app.svelte';
  import { storageUse } from '../lib/storage';
  import { icons } from './icons';

  let { onclose }: { onclose: () => void } = $props();

  const LANGUAGES: { label: string; ocr: string; lang: string }[] = [
    { label: 'English', ocr: 'eng', lang: 'en' },
    { label: 'English + French', ocr: 'eng+fra', lang: 'en' },
    { label: 'English + Spanish', ocr: 'eng+spa', lang: 'en' },
    { label: 'English + German', ocr: 'eng+deu', lang: 'en' },
    { label: 'English + Latin', ocr: 'eng+lat', lang: 'en' },
    { label: 'French', ocr: 'fra', lang: 'fr' },
    { label: 'Spanish', ocr: 'spa', lang: 'es' },
    { label: 'German', ocr: 'deu', lang: 'de' },
    { label: 'Italian', ocr: 'ita', lang: 'it' },
    { label: 'Portuguese', ocr: 'por', lang: 'pt' },
    { label: 'Dutch', ocr: 'nld', lang: 'nl' },
    { label: 'Latin', ocr: 'lat', lang: 'la' },
    { label: 'Greek (modern)', ocr: 'ell', lang: 'el' },
    { label: 'Ancient Greek', ocr: 'grc', lang: 'grc' },
    { label: 'Russian', ocr: 'rus', lang: 'ru' },
    { label: 'Chinese (Simplified)', ocr: 'chi_sim', lang: 'zh-Hans' },
    { label: 'Japanese', ocr: 'jpn', lang: 'ja' },
    { label: 'Korean', ocr: 'kor', lang: 'ko' },
    { label: 'Arabic', ocr: 'ara', lang: 'ar' },
    { label: 'Hebrew', ocr: 'heb', lang: 'he' },
  ];

  const s = $derived(app.bundle.settings);
  let used = $state<string>('');
  $effect(() => {
    void storageUse().then((u) => (used = u ? formatBytes(u.usage) : ''));
  });

  async function newWeek() {
    if (confirm('Start a new week? This removes all readings from this page. EPUBs you already downloaded are not affected.')) {
      await app.clearAll();
      onclose();
    }
  }
</script>

<div class="scrim" onclick={onclose} role="presentation"></div>
<aside class="sheet" aria-label="Settings">
  <header>
    <h2>Settings</h2>
    <button class="icon-btn" aria-label="Close settings" onclick={onclose}>{@html icons.close}</button>
  </header>

  <label class="row">
    <span>
      <span class="name">Language of the readings</span>
      <span class="help">Used to recognise text in scans and photos. Languages other than English are downloaded the first time.</span>
    </span>
    <select
      value={s.ocrLanguage}
      onchange={(e) => {
        const l = LANGUAGES.find((x) => x.ocr === (e.target as HTMLSelectElement).value)!;
        app.updateSettings({ ocrLanguage: l.ocr, language: l.lang });
      }}
    >
      {#each LANGUAGES as l (l.ocr)}
        <option value={l.ocr}>{l.label}</option>
      {/each}
    </select>
  </label>

  <label class="row">
    <span>
      <span class="name">Page numbers in the text</span>
      <span class="help">Small “[p. 47]” markers from the original, for citing.</span>
    </span>
    <input type="checkbox" class="switch" checked={s.pageMarkers} onchange={(e) => app.updateSettings({ pageMarkers: (e.target as HTMLInputElement).checked })} />
  </label>

  <label class="row">
    <span>
      <span class="name">Sections in the contents</span>
      <span class="help">List headings found inside each reading under it.</span>
    </span>
    <input
      type="checkbox"
      class="switch"
      checked={s.sectionsInToc}
      onchange={(e) => app.updateSettings({ sectionsInToc: (e.target as HTMLInputElement).checked })}
    />
  </label>

  <label class="row">
    <span>
      <span class="name">Kobo format (KEPUB)</span>
      <span class="help"
        >Faster page turns and better reading stats on Kobo. Kobo notes that sideloaded KEPUBs may not keep bookmarks and
        notes — try one first. Leave off for Boox.</span
      >
    </span>
    <input type="checkbox" class="switch" checked={s.kepub} onchange={(e) => app.updateSettings({ kepub: (e.target as HTMLInputElement).checked })} />
  </label>

  <div class="row">
    <span>
      <span class="name">Start a new week</span>
      <span class="help">Clears the current list{used ? ` (${used} saved in this browser)` : ''}.</span>
    </span>
    <button class="btn" onclick={newWeek}>Clear</button>
  </div>

  <p class="privacy">
    Your files never leave this device. Text recognition runs in your browser, and work in progress is saved in this
    browser only.
  </p>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.25);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100%);
    background: var(--surface);
    border-left: 1px solid var(--line);
    z-index: 21;
    padding: 1rem 1.5rem 2rem;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--line);
  }
  .name {
    display: block;
    font-weight: 500;
  }
  .help {
    display: block;
    color: var(--muted);
    font-size: 0.85rem;
  }
  select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    padding: 0.3em 0.4em;
    max-width: 11rem;
  }
  .switch {
    appearance: none;
    flex: none;
    width: 2.4rem;
    height: 1.4rem;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    cursor: pointer;
    transition: background 0.15s;
    margin-top: 0.15rem;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(1rem);
  }
  .privacy {
    color: var(--muted);
    font-size: 0.85rem;
    margin-top: 1.5rem;
  }
</style>
