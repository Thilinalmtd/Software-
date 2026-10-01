import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, AriaComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);

export interface ChartTheme {
  series: string[];
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  surface: string;
  line: string;
  isDark: boolean;
}

function readTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    surface: v('--chart-surface'),
    line: v('--line-strong'),
    isDark: document.documentElement.classList.contains('dark'),
  };
}

function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** Shared chrome: recessive hairline grid, text tokens for labels, rich hover tooltip. */
export function baseOption(t: ChartTheme): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter Variable, Segoe UI, sans-serif', color: t.ink2 },
    animationDuration: 300,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.line,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,0.12); border-radius: 8px;',
    },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, itemGap: 16, textStyle: { color: t.ink2, fontSize: 12 } },
  };
}

export function EChart({ option, height = 280, onClick, ariaLabel }: { option: (t: ChartTheme) => EChartsCoreOption; height?: number; onClick?: (params: { dataIndex: number; seriesIndex?: number; name: string }) => void; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = useChartTheme();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    chart.on('click', (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const base = baseOption(theme) as Record<string, Record<string, unknown>>;
    const own = option(theme) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...base, aria: { enabled: true, label: { description: ariaLabel } }, ...own };
    // Shallow-merge the shared chrome so charts can override single settings.
    for (const key of ['legend', 'tooltip', 'grid', 'textStyle']) {
      if (own[key] && typeof own[key] === 'object' && !Array.isArray(own[key])) merged[key] = { ...base[key], ...(own[key] as object) };
    }
    if (own.legend === undefined) merged.legend = { ...base.legend, show: false };
    chartRef.current?.setOption(merged, { notMerge: true });
  }, [option, theme, ariaLabel]);

  return <div ref={ref} style={{ height }} className={onClick ? 'cursor-pointer' : undefined} role="img" aria-label={ariaLabel} />;
}

export const compactNumber = (minor: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100);
