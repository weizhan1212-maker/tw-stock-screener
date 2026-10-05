/** 走勢小圖：SVG 折線，顏色跟漲跌（紅漲綠跌）。 */
export default function Sparkline({ data, up, width = 120, height = 36 }: {
  data: (number | null)[]; up: boolean | null; width?: number; height?: number;
}) {
  const pts = data.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][];
  if (pts.length < 2) return <div style={{ width, height }} />;
  const xs = pts.map(([i]) => i), ys = pts.map(([, v]) => v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (i: number) => ((i - x0) / (x1 - x0 || 1)) * (width - 2) + 1;
  const sy = (v: number) => height - 2 - ((v - y0) / (y1 - y0 || 1)) * (height - 4);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  const color = up == null ? "var(--muted)" : up ? "var(--up)" : "var(--down)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
