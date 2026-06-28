import type { DailyTrajectory } from "../sim-api";

export interface ChartScales {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  minDay: number;
  maxDay: number;
  minY: number;
  maxY: number;
}

export function buildChartScales(
  p5: DailyTrajectory[],
  p50: DailyTrajectory[],
  p95: DailyTrajectory[],
  width = 600,
  height = 220,
): ChartScales {
  const all = [...p5, ...p50, ...p95];
  const days = all.map((d) => d.day);
  const infected = all.map((d) => d.I);
  const minDay = Math.min(...days, 0);
  const maxDay = Math.max(...days, 1);
  const minY = 0;
  const maxY = Math.max(...infected, 1);
  return {
    width,
    height,
    padLeft: 40,
    padRight: 16,
    padTop: 12,
    padBottom: 28,
    minDay,
    maxDay,
    minY,
    maxY,
  };
}

function xScale(scales: ChartScales, day: number): number {
  const plotW = scales.width - scales.padLeft - scales.padRight;
  const range = scales.maxDay - scales.minDay || 1;
  return scales.padLeft + ((day - scales.minDay) / range) * plotW;
}

function yScale(scales: ChartScales, value: number): number {
  const plotH = scales.height - scales.padTop - scales.padBottom;
  const range = scales.maxY - scales.minY || 1;
  return scales.padTop + plotH - ((value - scales.minY) / range) * plotH;
}

export function buildLinePath(
  scales: ChartScales,
  trajectory: DailyTrajectory[],
): string {
  if (!trajectory.length) return "";
  return trajectory
    .map((d, i) => {
      const x = xScale(scales, d.day);
      const y = yScale(scales, d.I);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Closed polygon for p5–p95 band (upper forward, lower reverse). */
export function buildBandPolygon(
  scales: ChartScales,
  p5: DailyTrajectory[],
  p95: DailyTrajectory[],
): string {
  if (!p5.length || !p95.length) return "";
  const upper = p95.map((d) => `${xScale(scales, d.day).toFixed(1)},${yScale(scales, d.I).toFixed(1)}`);
  const lower = [...p5]
    .reverse()
    .map((d) => `${xScale(scales, d.day).toFixed(1)},${yScale(scales, d.I).toFixed(1)}`);
  return [...upper, ...lower].join(" ");
}

export function buildYTicks(scales: ChartScales, count = 4): number[] {
  const step = scales.maxY / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}

interface TrajectoryChartProps {
  p5: DailyTrajectory[];
  p50: DailyTrajectory[];
  p95: DailyTrajectory[];
}

export default function TrajectoryChart({ p5, p50, p95 }: TrajectoryChartProps) {
  const scales = buildChartScales(p5, p50, p95);
  const linePath = buildLinePath(scales, p50);
  const bandPath = buildBandPolygon(scales, p5, p95);
  const yTicks = buildYTicks(scales);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${scales.width} ${scales.height}`}
        className="w-full max-w-[600px]"
        role="img"
        aria-label="Infected trajectory p50 with p5-p95 band"
      >
        {bandPath ? (
          <polygon points={bandPath} fill="#4f46e5" fillOpacity={0.12} />
        ) : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ) : null}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={scales.padLeft}
              x2={scales.width - scales.padRight}
              y1={yScale(scales, tick)}
              y2={yScale(scales, tick)}
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text
              x={scales.padLeft - 6}
              y={yScale(scales, tick) + 3}
              textAnchor="end"
              className="fill-gray-400 text-[10px] font-mono"
            >
              {tick}
            </text>
          </g>
        ))}
        <text
          x={scales.width / 2}
          y={scales.height - 4}
          textAnchor="middle"
          className="fill-gray-400 text-[10px] font-mono"
        >
          day
        </text>
        <text
          x={8}
          y={scales.padTop + 8}
          className="fill-gray-400 text-[10px] font-mono"
        >
          infected
        </text>
      </svg>
    </div>
  );
}
