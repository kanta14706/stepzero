import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n';
import { floorLabel, panelOf, summariseFloor } from './floors';
import { testGraph, testMap } from './mapFixtures';

describe('floorLabel', () => {
  it('labels the ground, floors above and floors below in each language', () => {
    expect(floorLabel(0, dictionaries.ja)).toBe('地上');
    expect(floorLabel(-2, dictionaries.ja)).toBe('地下2階');
    expect(floorLabel(-2, dictionaries.en)).toBe('B2');
    expect(floorLabel(-2, dictionaries['zh-Hant'])).toBe('地下2樓');
    expect(floorLabel(-2, dictionaries['ja-easy'])).toBe('ちか2かい');
    expect(floorLabel(1, dictionaries.en)).toBe('Floor 1');
  });
});

describe('panelOf', () => {
  it('puts half floors on the floor below', () => {
    expect(panelOf(-0.5)).toBe(-1);
    expect(panelOf(-1.5)).toBe(-2);
    expect(panelOf(-1)).toBe(-1);
    expect(panelOf(0)).toBe(0);
    expect(panelOf(0.5)).toBe(0);
  });
});

describe('summariseFloor', () => {
  const g = testGraph();
  const m = testMap();

  it('lists entrances by label, unlabelled ones last, in natural order', () => {
    expect(summariseFloor(g, m, 0).entrances).toEqual(['A1', 'A10', null]);
  });

  it('counts edges by mode on the floor of their start node', () => {
    const ground = summariseFloor(g, m, 0);
    expect(ground).toMatchObject({ elevators: 1, escalators: 1, stairs: 0, gates: 0 });
    const b1 = summariseFloor(g, m, -1);
    expect(b1).toMatchObject({ gates: 1, stairs: 1, elevators: 0 });
  });

  it('shows platform boarding areas on the floor below a half floor', () => {
    expect(summariseFloor(g, m, -2).platforms).toEqual([{ id: 'P1', code: '3', areas: 2 }]);
    expect(summariseFloor(g, m, -1).platforms).toEqual([]);
  });

  it('counts toilets only where the floor has a map, and says unknown otherwise', () => {
    expect(summariseFloor(g, m, -1).toilets).toBe(1);
    expect(summariseFloor(g, m, 0).toilets).toBeNull();
  });
});
