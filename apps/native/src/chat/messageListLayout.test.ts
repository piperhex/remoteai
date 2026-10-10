import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from '@babel/core';
import { expect, it, vi } from 'vitest';
import { useStyles } from './styles';
const styles = useStyles();

vi.mock('../theme/store', () => ({ useThemeMode: () => 'light' }));

vi.mock('react-native', () => ({ StyleSheet: { create: <T>(value: T) => value } }));

interface Cell { index: number; offset: number; length: number }
interface RenderRange { first: number; last: number }
interface ListProps {
  data: Cell[]; getItemCount: (data: Cell[]) => number; getItem: (data: Cell[], index: number) => Cell;
}
type WindowCalculator = (...args: [ListProps, number, number, RenderRange,
  { getCellMetricsApprox: (index: number) => Cell },
  { offset: number; visibleLength: number; velocity: number; zoomScale: number }]) => RenderRange;

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve('react-native/package.json'));
const INITIAL_RENDER_RANGE = { first: 0, last: 9 };
const LONG_MESSAGE_HEIGHT = 15_000;
const TOOL_MESSAGE_HEIGHT = 40;
const TOOL_MESSAGE_COUNT = 100;
const RENDER_BATCH_SIZE = 10;
const WINDOW_SIZE = 21;

function loadWindowCalculator(collapseWindowFix: boolean): WindowCalculator {
  // Exercise the installed list algorithm: a mock list cannot expose blank virtualization spacers.
  const path = nativeRequire.resolve('@react-native/virtualized-lists/Lists/VirtualizeUtils.js');
  const transformed = transformSync(readFileSync(path, 'utf8'), { configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-flow-strip-types'),
      require.resolve('@babel/plugin-transform-modules-commonjs')] });
  if (!transformed?.code) throw new Error('Unable to compile the installed React Native list calculation.');
  const exported: { computeWindowedRenderLimits?: WindowCalculator } = {};
  const loadFeatureFlags = (name: string) => {
    if (name !== 'react-native/src/private/featureflags/ReactNativeFeatureFlags') {
      throw new Error(`Unexpected list calculation dependency: ${name}`);
    }
    return { fixVirtualizeListCollapseWindowSize: () => collapseWindowFix };
  };
  new Function('require', 'exports', transformed.code)(loadFeatureFlags, exported);
  if (!exported.computeWindowedRenderLimits) throw new Error('Missing native window calculation.');
  return exported.computeWindowedRenderLimits;
}

function measuredHistory() {
  const container: { padding: number; gap?: number; rowGap?: number } = styles.messages;
  const gap = container.rowGap ?? container.gap ?? 0;
  const heights = [LONG_MESSAGE_HEIGHT, ...Array<number>(TOOL_MESSAGE_COUNT).fill(TOOL_MESSAGE_HEIGHT)];
  let offset = container.padding;
  const cells = heights.map((height, index) => {
    // FlatList measures its ItemSeparator inside the cell; container gaps remain outside that measurement.
    const length = height + (index < heights.length - 1 ? styles.messageSeparator.height : 0);
    const cell = { index, offset, length };
    offset += length + gap;
    return cell;
  });
  const footerHeight = styles.messageFooter.paddingTop + styles.button.minHeight;
  return { cells, contentHeight: offset + footerHeight + container.padding };
}

it.each([false, true])('keeps the latest messages rendered beside the file-change footer (window fix: %s)', (fix) => {
  const calculate = loadWindowCalculator(fix);
  const { cells, contentHeight } = measuredHistory();
  const props: ListProps = { data: cells, getItemCount: (data) => data.length, getItem: (data, index) => data[index] };
  const metrics = { getCellMetricsApprox: (index: number) => cells[index] };
  // Include every offset around a row boundary and both keyboard viewport sizes.
  for (const viewport of [360, 600]) {
    for (let adjustment = 0; adjustment < TOOL_MESSAGE_HEIGHT; adjustment++) {
      const visibleLength = viewport + adjustment;
      const offset = contentHeight - visibleLength;
      const range = calculate(props, RENDER_BATCH_SIZE, WINDOW_SIZE, INITIAL_RENDER_RANGE,
        metrics, { offset, visibleLength, velocity: 0, zoomScale: 1 });
      const visibleCells = cells.filter((cell) => cell.offset + cell.length > offset
        && cell.offset < offset + visibleLength);
      expect(visibleCells.length).toBeGreaterThan(0);
      for (const cell of visibleCells) {
        expect(range.first, `viewport ${visibleLength}, message ${cell.index}`).toBeLessThanOrEqual(cell.index);
        expect(range.last, `viewport ${visibleLength}, message ${cell.index}`).toBeGreaterThanOrEqual(cell.index);
      }
    }
  }
});
