import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPACE_COLOUR,
  SPACE_COLOURS,
  mapFeatures,
  networkLines,
  networkPoints,
} from './geojson';
import { testGraph, testMap } from './mapFixtures';

describe('networkLines', () => {
  const lines = networkLines(testGraph());
  it('draws an edge only when both ends are on the same whole floor', () => {
    const ids = lines.features.map((f) => f.properties?.['id'] as string);
    expect(ids).toContain('e-walk');
    expect(ids).toContain('e-gate');
    expect(ids).not.toContain('e-lift'); // ground to B1
    expect(ids).not.toContain('e-st'); // B1 to B2 (half floor -1.5 is on panel -2)
  });
  it('tags every line with its mode and floor', () => {
    const walk = lines.features.find((f) => f.properties?.['id'] === 'e-walk');
    expect(walk?.properties).toMatchObject({ mode: 'walk', panel: 0 });
  });
});

describe('networkPoints', () => {
  it('leaves out plain junctions and labels only entrances', () => {
    const g = testGraph();
    const pts = networkPoints(g);
    expect(pts.features.every((f) => f.properties?.['kind'] !== 'junction')).toBe(true);
    const a1 = pts.features.find((f) => f.properties?.['id'] === 'a1');
    expect(a1?.properties?.['label']).toBe('A1');
    expect(pts.features.find((f) => f.properties?.['id'] === 'gate')?.properties?.['label']).toBe(
      '',
    );
  });
});

describe('mapFeatures', () => {
  it('adds a panel and a colour per category', () => {
    const fc = mapFeatures(testMap());
    const space = fc.features.find((f) => f.properties?.['kind'] === 'space');
    expect(space?.properties).toMatchObject({ panel: -1, colour: SPACE_COLOURS['B022'] });
    const facility = fc.features.find((f) => f.properties?.['category'] === 'F003');
    expect(facility?.properties?.['colour']).toBe(DEFAULT_SPACE_COLOUR);
  });
});
