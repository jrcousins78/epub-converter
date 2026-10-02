<script lang="ts">
  import type { DoodleName } from '../lib/delight.svelte';
  import { DOODLES } from './doodles';

  let { name, size = 22, animate = true }: { name: DoodleName; size?: number; animate?: boolean } = $props();
  const d = $derived(DOODLES[name]);
</script>

<svg
  class="doodle idle-{d.idle}"
  class:animate
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role="img"
  aria-label={d.label}
>
  <g class="motion">
    {#each d.paths as p, i (i)}
      <path d={p} pathLength="1" style:--i={i} class:dashed={d.dashed?.includes(i)} />
    {/each}
    {#each d.dots ?? [] as [cx, cy], i (i)}
      <circle {cx} {cy} r="0.6" fill="currentColor" stroke="none" class="dot" style:--i={d.paths.length + i} />
    {/each}
  </g>
</svg>

<style>
  .doodle {
    color: var(--accent);
    overflow: visible;
    flex: none;
  }
  .motion {
    transform-origin: 50% 70%;
    transform-box: fill-box;
  }
  .animate path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 0.55s cubic-bezier(0.65, 0, 0.35, 1) forwards;
    animation-delay: calc(var(--i) * 0.13s);
  }
  .animate path.dashed {
    stroke-dasharray: 0.08 0.07;
    stroke-dashoffset: 0;
    opacity: 0;
    animation: fade-in 0.4s ease forwards;
    animation-delay: calc(var(--i) * 0.13s);
  }
  .animate .dot {
    opacity: 0;
    animation: fade-in 0.2s ease forwards;
    animation-delay: calc(var(--i) * 0.13s + 0.2s);
  }
  .animate.idle-twinkle .motion {
    animation: twinkle 1.6s ease-in-out 0.7s infinite;
  }
  .animate.idle-sway .motion {
    animation: sway 2.2s ease-in-out 0.7s infinite;
  }
  .animate.idle-wave .motion {
    animation: wave 1.2s ease-in-out 0.8s infinite;
  }
  .animate.idle-float .motion {
    animation: float 1.8s ease-in-out 0.6s infinite;
  }
  .animate.idle-glow .motion {
    animation: glow 1.4s ease-in-out 0.8s infinite;
  }
  .animate.idle-steam path:last-child {
    animation:
      draw 0.55s cubic-bezier(0.65, 0, 0.35, 1) forwards calc(var(--i) * 0.13s),
      steam 1.6s ease-in-out 1s infinite;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes fade-in {
    to {
      opacity: 1;
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      transform: scale(1) rotate(0);
    }
    50% {
      transform: scale(1.08) rotate(6deg);
    }
  }
  @keyframes sway {
    0%,
    100% {
      transform: rotate(-5deg);
    }
    50% {
      transform: rotate(5deg);
    }
  }
  @keyframes wave {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-1.5px) rotate(-3deg);
    }
  }
  @keyframes float {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(1.5px, -2px);
    }
  }
  @keyframes glow {
    0%,
    100% {
      filter: none;
    }
    50% {
      filter: drop-shadow(0 0 3px var(--accent));
    }
  }
  @keyframes steam {
    0%,
    100% {
      transform: translateY(0);
      opacity: 1;
    }
    50% {
      transform: translateY(-1.5px);
      opacity: 0.5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animate path,
    .animate .dot,
    .animate .motion {
      animation: none !important;
      stroke-dashoffset: 0;
      opacity: 1;
    }
  }
</style>
