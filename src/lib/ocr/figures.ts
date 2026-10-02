// Finds pictures, charts and diagrams on a page: areas with ink that no line
// of recognised text explains.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function detectFigures(gray: Uint8ClampedArray, width: number, height: number, textBoxes: Box[], lineHeight: number): Box[] {
  const cell = Math.max(8, Math.round(Math.min(width, height) / 70));
  const gw = Math.ceil(width / cell);
  const gh = Math.ceil(height / cell);
  const ink = new Float32Array(gw * gh);
  const tone = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let dark = 0;
      let mid = 0;
      let n = 0;
      const x1 = Math.min(width, (gx + 1) * cell);
      const y1 = Math.min(height, (gy + 1) * cell);
      for (let y = gy * cell; y < y1; y += 2)
        for (let x = gx * cell; x < x1; x += 2) {
          const v = gray[y * width + x];
          if (v < 128) dark++;
          else if (v < 215) mid++;
          n++;
        }
      ink[gy * gw + gx] = dark / n;
      tone[gy * gw + gx] = mid / n;
    }

  // Cells covered by recognised text (padded a little) are not figures.
  const isText = new Uint8Array(gw * gh);
  const pad = lineHeight * 0.4;
  for (const b of textBoxes) {
    const gx0 = Math.max(0, Math.floor((b.x0 - pad) / cell));
    const gx1 = Math.min(gw - 1, Math.floor((b.x1 + pad) / cell));
    const gy0 = Math.max(0, Math.floor((b.y0 - pad) / cell));
    const gy1 = Math.min(gh - 1, Math.floor((b.y1 + pad) / cell));
    for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) isText[y * gw + x] = 1;
  }

  // Ignore a band around the edges (scanner borders, page shadows).
  const edge = 0.04;
  const cand = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx;
      if (gx < gw * edge || gx > gw * (1 - edge) || gy < gh * edge || gy > gh * (1 - edge)) continue;
      if (!isText[i] && (ink[i] > 0.03 || tone[i] > 0.25)) cand[i] = 1;
    }

  // Close small gaps so a line drawing becomes one region.
  const closed = new Uint8Array(cand);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      if (cand[gy * gw + gx]) continue;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < gw && y < gh && cand[y * gw + x]) n++;
        }
      if (n >= 6 && !isText[gy * gw + gx]) closed[gy * gw + gx] = 1;
    }

  // Connected components.
  const seen = new Uint8Array(gw * gh);
  const boxes: (Box & { cells: number })[] = [];
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = gw;
    let y0 = gh;
    let x1 = 0;
    let y1 = 0;
    let cells = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw;
      const y = (k / gw) | 0;
      cells++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (closed[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    boxes.push({ x0, y0, x1, y1, cells });
  }

  return boxes
    .filter((b) => {
      const w = b.x1 - b.x0 + 1;
      const h = b.y1 - b.y0 + 1;
      return w >= gw * 0.12 && h >= gh * 0.06 && w * h >= gw * gh * 0.025 && b.cells >= w * h * 0.3;
    })
    .map((b) => ({
      x0: Math.max(0, (b.x0 - 0.5) * cell),
      y0: Math.max(0, (b.y0 - 0.5) * cell),
      x1: Math.min(width, (b.x1 + 1.5) * cell),
      y1: Math.min(height, (b.y1 + 1.5) * cell),
    }));
}

export function inside(box: Box, x: number, y: number): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}
