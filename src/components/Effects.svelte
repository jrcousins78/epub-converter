<script lang="ts">
  import { fly } from 'svelte/transition';
  import { backOut } from 'svelte/easing';
  import { delight } from '../lib/delight.svelte';
  import Doodle from './Doodle.svelte';

  const rays = Array.from({ length: 8 }, (_, i) => (i * 360) / 8 + 22.5);
</script>

<div class="fx">
  {#each delight.effects as e (e.id)}
    {#if e.type === 'success'}
      <div class="success" style:left="{e.x}px" style:top="{e.y}px" aria-hidden="true">
        <svg class="burst" viewBox="-40 -40 80 80" width="80" height="80">
          {#each rays as a, i (i)}
            <g transform="rotate({a})"><line x1="0" y1="-14" x2="0" y2="-22" style:--i={i} /></g>
          {/each}
        </svg>
        <svg class="book" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 3.5h11.5v15H7.2A1.7 1.7 0 0 0 5.5 20.2V5A1.5 1.5 0 0 1 7 3.5" />
          <path d="M5.5 20.2a1.7 1.7 0 0 0 1.7 1.3h10.3v-3" />
          <path d="M9 8h5.5" />
        </svg>
      </div>
    {:else if e.type === 'card' && e.doodle}
      <div class="card-wrap" role="status" in:fly={{ y: 16, duration: 380, easing: backOut }} out:fly={{ y: 8, duration: 200 }}>
        <button class="card" onclick={() => delight.dismiss(e.id)} data-testid="milestone">
          <Doodle name={e.doodle} size={34} />
          <span>{e.text}</span>
        </button>
      </div>
    {/if}
  {/each}
</div>

<style>
  .fx {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 60;
  }
  .success {
    position: absolute;
    width: 0;
    height: 0;
    color: var(--accent);
  }
  .burst {
    position: absolute;
    left: -40px;
    top: -40px;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .burst line {
    opacity: 0;
    animation: ray 0.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
    animation-delay: calc(var(--i) * 12ms);
  }
  @keyframes ray {
    0% {
      opacity: 0;
      translate: 0 6px;
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      translate: 0 -8px;
    }
  }
  .book {
    position: absolute;
    left: -11px;
    top: -11px;
    opacity: 0;
    animation: book 1.1s cubic-bezier(0.34, 1.3, 0.64, 1) forwards;
  }
  @keyframes book {
    0% {
      opacity: 0;
      transform: translateY(0) scale(0.4) rotate(-12deg);
    }
    25% {
      opacity: 1;
      transform: translateY(-34px) scale(1) rotate(0);
    }
    55% {
      opacity: 1;
      transform: translateY(-34px) scale(1) rotate(0);
    }
    100% {
      opacity: 0;
      transform: translateY(10px) scale(0.7) rotate(0);
    }
  }
  .card-wrap {
    position: fixed;
    left: 50%;
    bottom: 5.5rem;
    translate: -50% 0;
  }
  .card {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: min(92vw, 420px);
    padding: 0.7rem 1.1rem 0.7rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--fg);
    font-size: 0.9rem;
    text-align: left;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.08);
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .success {
      display: none;
    }
  }
</style>
