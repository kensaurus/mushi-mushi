import { describe, expect, it } from 'vitest';
import {
  MUSHI_COLORS_LIGHT,
  MUSHI_COLORS_DARK,
  MUSHI_GEOMETRY,
  MUSHI_Z,
} from '@mushi-mushi/core';
import { getWidgetStyles } from './styles';

describe('getWidgetStyles', () => {
  it('embeds core palette tokens for light theme', () => {
    const css = getWidgetStyles('light');
    expect(css).toContain(MUSHI_COLORS_LIGHT.paper);
    expect(css).toContain(MUSHI_COLORS_LIGHT.ink);
    expect(css).toContain(MUSHI_COLORS_LIGHT.accent);
    expect(css).toContain(String(MUSHI_GEOMETRY.fabSize));
    expect(css).toContain(String(MUSHI_GEOMETRY.panelWidth));
    expect(css).toContain(String(MUSHI_Z.banner));
  });

  it('embeds core palette tokens for dark theme', () => {
    const css = getWidgetStyles('dark');
    expect(css).toContain(MUSHI_COLORS_DARK.paper);
    expect(css).toContain(MUSHI_COLORS_DARK.accent);
  });

  it('honours safe custom accent override', () => {
    const css = getWidgetStyles('light', '#112233');
    expect(css).toContain('#112233');
  });

  it('rejects unsafe accent override', () => {
    const css = getWidgetStyles('light', 'javascript:alert(1)');
    expect(css).toContain(MUSHI_COLORS_LIGHT.accent);
    expect(css).not.toContain('javascript');
  });

  it('matches stable CSS snapshot markers', () => {
    const css = getWidgetStyles('light');
    expect(css).toMatchSnapshot();
  });
});
