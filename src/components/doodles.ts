// Line-art doodles (24×24, drawn with a single stroke weight). Each path is
// drawn on in turn; `idle` names a small looping motion after drawing.
import type { DoodleName } from '../lib/delight.svelte';

export interface DoodleDef {
  label: string;
  paths: string[];
  /** Paths drawn dashed (motion trails). */
  dashed?: number[];
  /** Small filled dots (eyes, sparkles): [cx, cy]. */
  dots?: [number, number][];
  idle: 'twinkle' | 'sway' | 'wave' | 'float' | 'glow' | 'steam' | 'none';
}

export const DOODLES: Record<DoodleName, DoodleDef> = {
  star: {
    label: 'A little star',
    paths: ['M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z', 'M20.2 2.6v3M18.7 4.1h3', 'M4.2 17.6v2.2M3.1 18.7h2.2'],
    idle: 'twinkle',
  },
  leaf: {
    label: 'A new leaf',
    paths: ['M5 19.5C5 11 10.5 5.2 19.5 4.5 19 13.5 13.5 19.2 5 19.5z', 'M5 19.5c3.2-3.4 6.7-6.9 10.6-10.6', 'M9 15.6v-3.1M12.2 12.4V9.7M9 15.6h3.1M12.2 12.4H15'],
    idle: 'sway',
  },
  bookworm: {
    label: 'A bookworm says hi',
    paths: [
      'M2.5 21c3.2-1.3 6.3-1.3 9.5 0 3.2-1.3 6.3-1.3 9.5 0V12c-3.2-1.3-6.3-1.3-9.5 0-3.2-1.3-6.3-1.3-9.5 0z',
      'M12 12v9',
      'M14.2 11.4c-.3-2.6 1.1-4.4 3.3-4.6',
      'M21.4 6.2a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 1 1 5.2 0z',
    ],
    dots: [[19.6, 5.6]],
    idle: 'wave',
  },
  plane: {
    label: 'Paper plane',
    paths: ['M21 3.5 3 10.8l6.3 2.6L12 20z', 'M21 3.5 9.3 13.4', 'M2.8 20.6c1.7-.4 3-1.2 4-2.5'],
    dashed: [2],
    idle: 'float',
  },
  bulb: {
    label: 'Bright idea',
    paths: [
      'M12 3.6a5.7 5.7 0 0 0-3.4 10.3c.6.5.9 1.1.9 1.9v.5h5v-.5c0-.8.3-1.4.9-1.9A5.7 5.7 0 0 0 12 3.6z',
      'M9.8 18.9h4.4M10.6 21.1h2.8',
      'M10.4 12.4l1.6-1.6 1.6 1.6',
      'M3.1 9.4h1.6M19.3 9.4h1.6M5.3 3.5l1.1 1.1M18.7 3.5l-1.1 1.1',
    ],
    idle: 'glow',
  },
  coffee: {
    label: 'Coffee break',
    paths: ['M5 10.5h11v4.4a4.6 4.6 0 0 1-4.6 4.6H9.6A4.6 4.6 0 0 1 5 14.9z', 'M16 12h1.3a2.2 2.2 0 0 1 0 4.4H16', 'M3.5 21.6h15', 'M8.6 7.9c-.9-1.1.9-2 0-3.3M12.3 7.9c-.9-1.1.9-2 0-3.3'],
    idle: 'steam',
  },
  stack: {
    label: 'A stack of books',
    paths: ['M4 17.5h16v3.5H4z', 'M5.5 13.5h13.5v4H5.5z', 'M3.5 9.5h14v4h-14z', 'M7 9.5v4M9.5 13.5v4M16 17.5v3.5', 'M10.5 3v3M7.6 4.2l1.3 1.6M13.4 4.2l-1.3 1.6'],
    idle: 'none',
  },
  shelf: {
    label: 'A full shelf',
    paths: [
      'M2.5 21h19M2.5 3v18M21.5 3v18',
      'M4.5 21v-8h2.2v8M7.2 21v-6.5h2v6.5M9.7 21v-8.8h2.3V21',
      'M12.6 20.8l2-7.6 2.1.6-2 7.4M17.5 21v-7h2.2v7',
      'M4.5 10h15',
      'M5 10V5.5h2.3V10M8 10V6.8h1.8V10M10.6 10V4.8h2.5V10M14 10V6.2h2V10M16.8 10V5.2h2.2V10',
    ],
    idle: 'none',
  },
  mountain: {
    label: 'Summit',
    paths: ['M2.5 21h19', 'M4 21l4.5-7 3 3.5 3.5-6 5 9.5', 'M15 11.5V5', 'M15 5l4 1.4-4 1.5'],
    idle: 'sway',
  },
  library: {
    label: 'Your own library',
    paths: ['M3 21h18M4 18.5h16', 'M3.5 8.5L12 3.5l8.5 5z', 'M6 18.5v-8M10 18.5v-8M14 18.5v-8M18 18.5v-8', 'M4 10.5h16'],
    idle: 'none',
  },
  openbook: {
    label: 'Your first book',
    paths: [
      'M2.5 19.5c3.2-1.3 6.3-1.3 9.5 0 3.2-1.3 6.3-1.3 9.5 0V8.5c-3.2-1.3-6.3-1.3-9.5 0-3.2-1.3-6.3-1.3-9.5 0z',
      'M12 8.5v11',
      'M5 11c1.6-.5 3.2-.5 4.6 0M5 13.8c1.6-.5 3.2-.5 4.6 0M14.4 11c1.6-.5 3.2-.5 4.6 0M14.4 13.8c1.6-.5 3.2-.5 4.6 0',
      'M12 2.5v2.4M8.6 3.6l1 1.6M15.4 3.6l-1 1.6',
    ],
    idle: 'twinkle',
  },
};
