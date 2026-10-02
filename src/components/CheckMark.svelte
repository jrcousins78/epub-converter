<script lang="ts">
  // A small check mark that draws itself inside a ring that pops.
  let { size = 16 }: { size?: number } = $props();
</script>

<svg class="check" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Done">
  <circle class="ring" cx="12" cy="12" r="9.5" pathLength="1" />
  <path class="tick" d="M7.6 12.4l3 3 5.8-6.2" pathLength="1" />
</svg>

<style>
  .check {
    color: var(--accent);
    flex: none;
    vertical-align: -0.2em;
  }
  .ring {
    stroke-width: 1.4;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transform-origin: center;
    transform-box: fill-box;
    animation:
      ring 0.45s cubic-bezier(0.65, 0, 0.35, 1) forwards,
      pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s;
  }
  .tick {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: ring 0.3s cubic-bezier(0.65, 0, 0.35, 1) 0.3s forwards;
  }
  @keyframes ring {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes pop {
    50% {
      transform: scale(1.18);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring,
    .tick {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>
