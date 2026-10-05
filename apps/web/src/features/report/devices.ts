import { panelOf } from '../../routing/steps';
import type { GraphEdge, GraphNode, OutageReport, StationGraph } from '../../routing/types';

/**
 * Reportable devices, grouped the same way as the back end (importer/graph/devices.py, D-022):
 * an elevator shaft is a connected group of elevator edges, an escalator is one edge.
 */
export interface Device {
  id: string;
  mode: 'elevator' | 'escalator';
  edgeIds: string[];
  /** Highest and lowest whole floor (map panel) the device reaches. */
  topPanel: number;
  bottomPanel: number;
  /** Escalators are one-way; elevators have no direction. */
  direction: 'up' | 'down' | null;
  /** Label of the nearest entrance within reach, for devices that reach the street. */
  entrance: string | null;
}

/** An entrance this close to a street-level device names it (as for elevator steps, D-020). */
const NEAR_ENTRANCE_M = 30;

function metres(a: GraphNode, b: GraphNode): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lon - b.lon) * 111_320 * k;
  const dy = (a.lat - b.lat) * 110_540;
  return Math.hypot(dx, dy);
}

export interface DeviceIndex {
  byEdge: ReadonlyMap<string, Device>;
  devices: readonly Device[];
}

export function indexDevices(graph: StationGraph): DeviceIndex {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const entrances = graph.nodes.filter((n) => n.kind === 'entrance' && n.name?.['ja']);

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(x, root);
    return root;
  };
  const elevators = graph.edges.filter((e) => e.mode === 'elevator');
  for (const e of elevators) parent.set(find(e.from), find(e.to));
  const shafts = new Map<string, GraphEdge[]>();
  for (const e of elevators) {
    const root = find(e.from);
    shafts.set(root, [...(shafts.get(root) ?? []), e]);
  }

  const groups: [Device['mode'], GraphEdge[]][] = [
    ...[...shafts.values()].map((es): [Device['mode'], GraphEdge[]] => ['elevator', es]),
    ...graph.edges
      .filter((e) => e.mode === 'escalator')
      .map((e): [Device['mode'], GraphEdge[]] => ['escalator', [e]]),
  ];

  const devices: Device[] = [];
  for (const [mode, edges] of groups) {
    const ends = edges
      .flatMap((e) => [nodes.get(e.from), nodes.get(e.to)])
      .filter((n): n is GraphNode => n !== undefined);
    if (ends.length === 0) continue;
    const levels = ends.map((n) => n.level);
    const top = Math.max(...levels);
    let entrance: string | null = null;
    if (top >= 0) {
      let best = NEAR_ENTRANCE_M;
      for (const en of entrances) {
        for (const n of ends) {
          const d = metres(en, n);
          if (d <= best) {
            best = d;
            entrance = en.name?.['ja'] ?? null;
          }
        }
      }
    }
    const first = edges[0];
    const from = first ? nodes.get(first.from) : undefined;
    const to = first ? nodes.get(first.to) : undefined;
    const direction =
      mode === 'escalator' && from && to && from.level !== to.level
        ? to.level > from.level
          ? 'up'
          : 'down'
        : null;
    const ids = edges.map((e) => e.id).sort();
    devices.push({
      id: `${mode}:${ids[0] ?? ''}`,
      mode,
      edgeIds: ids,
      topPanel: panelOf(top),
      bottomPanel: panelOf(Math.min(...levels)),
      direction,
      entrance,
    });
  }
  const byEdge = new Map<string, Device>();
  for (const d of devices) for (const id of d.edgeIds) byEdge.set(id, d);
  return { byEdge, devices };
}

export interface DeviceOutage {
  device: Device;
  /** The newest active out-of-service report on the device. */
  report: OutageReport;
}

/** Devices with an active out-of-service report, newest report first. */
export function devicesOutOfService(
  index: DeviceIndex,
  reports: readonly OutageReport[],
): DeviceOutage[] {
  const newest = new Map<Device, OutageReport>();
  for (const r of reports) {
    const device = index.byEdge.get(r.edgeId);
    if (!device) continue;
    const prev = newest.get(device);
    if (!prev || Date.parse(r.createdAt) >= Date.parse(prev.createdAt)) newest.set(device, r);
  }
  return [...newest]
    .filter(([, r]) => r.status === 'out_of_service' || r.status === 'blocked')
    .map(([device, report]) => ({ device, report }))
    .sort((a, b) => Date.parse(b.report.createdAt) - Date.parse(a.report.createdAt));
}
