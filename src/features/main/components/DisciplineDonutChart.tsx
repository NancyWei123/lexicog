import { useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';

export interface DisciplineArcData {
  code: string;
  name: string;
  count: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  HA: 'var(--chart-1)',
  SS: 'var(--chart-2)',
  NS: 'var(--chart-3)',
  ET: 'var(--chart-4)',
  ML: 'var(--chart-5)',
  BM: 'var(--chart-1)',
  FG: 'var(--chart-3)',
};

const SIZE = 420;
const OUTER_R = SIZE / 2 - 34;
const INNER_R = OUTER_R * 0.56;

export function getDisciplineColor(code: string): string {
  const category = code.split('.')[0];
  return CATEGORY_COLORS[category] ?? 'var(--chart-5)';
}

interface DisciplineDonutChartProps {
  data: DisciplineArcData[];
  onArcClick: (code: string) => void;
  idleLabel: string;
  idleValue: string;
  disabled?: boolean;
  className?: string;
}

export function DisciplineDonutChart({
  data,
  onArcClick,
  idleLabel,
  idleValue,
  disabled = false,
  className,
}: DisciplineDonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const pie = useMemo(
    () =>
      d3
        .pie<DisciplineArcData>()
        .value((item) => item.count)
        .sort(null)
        .padAngle(0.02),
    [],
  );

  const arcs = useMemo(() => pie(data), [pie, data]);

  const distanceFromHovered = useCallback(
    (index: number) => {
      if (hoveredIndex === null) return null;
      const total = arcs.length;
      return Math.min(
        Math.abs(index - hoveredIndex),
        total - Math.abs(index - hoveredIndex),
      );
    },
    [arcs.length, hoveredIndex],
  );

  const radiusBoostFor = useCallback(
    (index: number) => {
      const distance = distanceFromHovered(index);
      if (distance === null) return 0;
      if (distance === 0) return 20;
      if (distance === 1) return 11;
      if (distance === 2) return 5;
      return 0;
    },
    [distanceFromHovered],
  );

  const opacityFor = useCallback(
    (index: number) => {
      const distance = distanceFromHovered(index);
      if (distance === null) return 1;
      if (distance === 0) return 1;
      if (distance === 1) return 0.88;
      if (distance === 2) return 0.68;
      return 0.38;
    },
    [distanceFromHovered],
  );

  const hovered = hoveredIndex !== null ? data[hoveredIndex] : null;
  const centerPrimary = hovered ? hovered.name : idleValue;
  const centerSecondary = hovered
    ? hovered.count.toLocaleString()
    : idleLabel;
  const half = SIZE / 2;

  if (data.length === 0) return null;

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full max-h-full max-w-full"
      >
        <g transform={`translate(${half},${half})`}>
          {arcs.map((arc, index) => {
            const path = d3
              .arc<d3.PieArcDatum<DisciplineArcData>>()
              .innerRadius(INNER_R)
              .outerRadius(OUTER_R + radiusBoostFor(index))
              .cornerRadius(8)(arc);

            return (
              <path
                key={data[index].code}
                d={path ?? ''}
                fill={getDisciplineColor(data[index].code)}
                stroke="rgba(253, 251, 247, 0.92)"
                strokeWidth={2}
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: opacityFor(index),
                  transition:
                    'opacity 180ms ease, filter 180ms ease, d 180ms ease',
                  filter:
                    hoveredIndex === index
                      ? 'drop-shadow(0 10px 18px rgba(44, 42, 40, 0.16))'
                      : 'none',
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => {
                  if (!disabled) {
                    onArcClick(data[index].code);
                  }
                }}
              />
            );
          })}

          <g className="pointer-events-none">
            <circle
              r={INNER_R - 16}
              fill="var(--color-bg-base)"
              opacity={0.98}
            />
            <circle
              r={INNER_R - 16}
              fill="none"
              stroke="rgba(0, 0, 0, 0.04)"
              strokeWidth={1}
            />
            <text
              textAnchor="middle"
              dy={hovered ? '-0.2em' : '-0.15em'}
              fill="var(--color-text-primary)"
              fontSize={hovered ? 13 : 28}
              fontWeight={hovered ? 500 : 650}
              fontFamily={hovered ? 'var(--font-sans)' : 'var(--font-serif)'}
            >
              {centerPrimary}
            </text>
            <text
              textAnchor="middle"
              dy={hovered ? '1.45em' : '1.25em'}
              fill="var(--color-text-secondary)"
              fontSize={hovered ? 12 : 12}
              fontFamily={hovered ? 'var(--font-serif)' : 'var(--font-sans)'}
            >
              {centerSecondary}
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
