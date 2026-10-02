<script lang="ts">
  import { getImage } from '../lib/storage';

  let { id, alt = '', onclick }: { id: string; alt?: string; onclick?: () => void } = $props();
  let url = $state<string | undefined>(undefined);

  $effect(() => {
    let revoked = false;
    let made: string | undefined;
    void getImage(id).then((img) => {
      if (!img || revoked) return;
      made = URL.createObjectURL(new Blob([img.data as Uint8Array<ArrayBuffer>], { type: img.mime }));
      url = made;
    });
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  });
</script>

{#if url}
  {#if onclick}
    <button class="thumb-btn" {onclick} aria-label="Enlarge"><img src={url} {alt} loading="lazy" /></button>
  {:else}
    <img src={url} {alt} loading="lazy" />
  {/if}
{:else}
  <span class="ph" aria-hidden="true"></span>
{/if}

<style>
  img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: #fff;
  }
  .thumb-btn {
    display: block;
    padding: 0;
    border: 0;
    background: none;
    width: 100%;
    cursor: zoom-in;
  }
  .ph {
    display: block;
    aspect-ratio: 3 / 4;
    border-radius: 6px;
    background: var(--hover);
  }
</style>
