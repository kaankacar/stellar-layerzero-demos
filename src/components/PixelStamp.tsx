/** Deterministic 8x8 pixel-art "stamp" derived from a message GUID. Symmetric, two colours. */
export function PixelStamp({ seed, size = 56 }: { seed: string; size?: number }) {
  const bytes = seed.replace(/^0x/, '').match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [0];
  const hue = (bytes[0]! * 7 + bytes[1]!) % 360;
  const hue2 = (hue + 140 + bytes[2]!) % 360;
  const cells: boolean[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 4; x++) {
      const b = bytes[(y * 4 + x) % bytes.length]!;
      row.push(((b >> (x % 8)) & 1) === 1 ? true : (b & 0x40) !== 0);
    }
    cells.push([...row, ...row.slice().reverse()]);
  }
  const cell = size / 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-sm shadow" role="img" aria-label="stamp">
      <rect width={size} height={size} fill={`hsl(${hue2} 45% 92%)`} />
      {cells.map((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={`hsl(${hue} 60% 45%)`} /> : null)))}
      <rect x={1} y={1} width={size - 2} height={size - 2} fill="none" stroke="white" strokeDasharray="3 2" />
    </svg>
  );
}
