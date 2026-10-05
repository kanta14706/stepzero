import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../i18n';
import { edge, graph, node } from '../../routing/fixtures';
import { devicesOutOfService, indexDevices } from './devices';
import { outage } from './fakeSource';
import { deviceName, reportTime } from './ReportControls';

/** A three-hop elevator at exit A1 from the street to B2, and an up escalator B2 to B1 far away. */
function g() {
  return graph(
    [
      { ...node('a1', 'entrance', 0), name: { ja: 'A1' } },
      node('hall0', 'junction', 0),
      node('cab0', 'elevator', 0),
      node('cab2', 'elevator', -2),
      node('hall2', 'junction', -2),
      node('esc-bot', 'junction', -2, 139.01, 35),
      node('esc-top', 'junction', -1, 139.01, 35),
    ],
    [
      edge('in', 'hall0', 'cab0', 'elevator'),
      edge('ride', 'cab0', 'cab2', 'elevator'),
      edge('out', 'cab2', 'hall2', 'elevator'),
      edge('esc', 'esc-bot', 'esc-top', 'escalator', { bidirectional: false }),
      edge('walk', 'a1', 'hall0', 'walk'),
    ],
  );
}

describe('indexDevices', () => {
  it('groups an elevator shaft and keeps each escalator separate', () => {
    const idx = indexDevices(g());
    expect(idx.devices).toHaveLength(2);
    const lift = idx.byEdge.get('ride');
    expect(lift?.edgeIds).toEqual(['in', 'out', 'ride']);
    expect(idx.byEdge.get('in')).toBe(lift);
    expect(lift).toMatchObject({ mode: 'elevator', topPanel: 0, bottomPanel: -2, entrance: 'A1' });
    expect(idx.byEdge.get('esc')).toMatchObject({
      mode: 'escalator',
      direction: 'up',
      entrance: null,
    });
    expect(idx.byEdge.has('walk')).toBe(false);
  });
});

describe('deviceName', () => {
  it('names the device by floors and the entrance it is near, in each language', () => {
    const idx = indexDevices(g());
    const lift = idx.byEdge.get('ride');
    const esc = idx.byEdge.get('esc');
    if (!lift || !esc) throw new Error('fixture');
    expect(deviceName(lift, dictionaries.ja)).toBe('A1出入口付近のエレベーター（地上〜地下2階）');
    expect(deviceName(lift, dictionaries.en)).toBe('Elevator (Ground to B2), near exit A1');
    expect(deviceName(esc, dictionaries.ja)).toBe('上りエスカレーター（地下2階〜地下1階）');
    expect(deviceName(esc, dictionaries['zh-Hant'])).toBe('上行手扶梯（地下2樓至地下1樓）');
  });
});

describe('devicesOutOfService', () => {
  it('lists each broken device once, from the newest report, and skips working ones', () => {
    const idx = indexDevices(g());
    const list = devicesOutOfService(idx, [
      outage({ id: '1', edgeId: 'in' }),
      outage({ id: '2', edgeId: 'ride' }),
      outage({ id: '3', edgeId: 'esc', status: 'working' }),
      outage({ id: '4', edgeId: 'not-a-device' }),
    ]);
    expect(list.map((x) => x.device.mode)).toEqual(['elevator']);
  });
});

describe('reportTime', () => {
  it('shows Tokyo time', () => {
    expect(reportTime('2026-10-06T01:05:00Z', 'ja')).toBe('10:05');
  });
});
