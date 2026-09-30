'use client';

import React from 'react';

export interface ChartPoint {
  date: string;
  value: number;
}

interface AnalyticsChartProps {
  points: ChartPoint[];
  /** Series name used for the aria summary and bar tooltips (e.g. "Scans"). */
  seriesLabel: string;
  /** Bar fill color (brand green / on-surface-variant / surface-tint / amber per series). */
  color?: string;
}

const W = 640;
const H = 240;
const PAD = { top: 16, right: 10, bottom: 30, left: 44 };

/**
 * Zero-dependency SVG bar chart (Phase 4). One bar per day, gridlines at
 * 0 / mid / max, at most ~6 x-axis labels, and a `<title>` per bar so hover
 * exposes the exact value. `role="img"` + aria-label summarize the series.
 */
export const AnalyticsChart: React.FC<AnalyticsChartProps> = ({
  points,
  seriesLabel,
  color = '#0D472A',
}) => {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxValue = points.reduce((max, p) => Math.max(max, p.value), 0);
  const yMax = Math.max(1, maxValue);
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const peak = points.find((p) => p.value === maxValue);

  const slot = points.length > 0 ? innerW / points.length : innerW;
  const barW = Math.max(2, Math.min(slot * 0.68, 40));

  const yFor = (value: number) => PAD.top + innerH - (value / yMax) * innerH;
  const xFor = (index: number) => PAD.left + index * slot + (slot - barW) / 2;

  const midValue = Math.round(yMax / 2);
  // Dedupe: with yMax 1-2 the mid line lands on 0 or max.
  const gridValues = (yMax === 1 && maxValue === 0 ? [0, 1] : [0, midValue, yMax]).filter(
    (value, index, all) => all.indexOf(value) === index
  );

  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  const labelIndexes = points.map((_, i) => i).filter((i) => i % labelStep === 0);
  if (points.length > 0 && labelIndexes[labelIndexes.length - 1] !== points.length - 1) {
    const last = points.length - 1;
    // Drop the second-to-last label if it would collide with the last one.
    if (last - labelIndexes[labelIndexes.length - 1] < labelStep / 2) labelIndexes.pop();
    labelIndexes.push(last);
  }

  const ariaLabel = `${seriesLabel} by day: ${total} total across ${points.length} days` +
    (maxValue > 0 && peak ? `, peak ${maxValue} on ${peak.date}` : '');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Gridlines + y labels */}
      {gridValues.map((value) => {
        const y = yFor(value);
        return (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              className="stroke-surface-container-highest"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              className="fill-on-surface-variant font-label-sm"
            >
              {value}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {points.map((point, index) => {
        const height = (point.value / yMax) * innerH;
        const y = PAD.top + innerH - height;
        return (
          <g key={point.date}>
            <rect
              x={xFor(index)}
              y={point.value > 0 ? y : PAD.top + innerH - 1}
              width={barW}
              height={point.value > 0 ? Math.max(height, 2) : 1}
              rx={3}
              fill={color}
              // Zero-value baseline uses the token fill instead of a hardcoded grey.
              className={point.value > 0 ? undefined : 'fill-surface-container-high'}
            >
              <title>{`${point.date}: ${point.value} ${point.value === 1 ? seriesLabel.replace(/s$/, '') : seriesLabel}`}</title>
            </rect>
          </g>
        );
      })}

      {/* X labels */}
      {labelIndexes.map((index) => (
        <text
          key={index}
          x={xFor(index) + barW / 2}
          y={H - 10}
          textAnchor="middle"
          fontSize={10}
          className="fill-on-surface-variant font-label-sm"
        >
          {points[index].date.slice(5)}
        </text>
      ))}
    </svg>
  );
};
