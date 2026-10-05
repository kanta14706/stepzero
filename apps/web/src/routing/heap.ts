/** Binary min-heap keyed by a number. Small and allocation-light for the router's hot loop. */
export class MinHeap<T> {
  private items: { key: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const a = items[i];
      const b = items[parent];
      if (!a || !b || b.key <= a.key) break;
      items[i] = b;
      items[parent] = a;
      i = parent;
    }
  }

  pop(): { key: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (!top || !last) return undefined;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        const cur = items[smallest];
        const left = items[l];
        const right = items[r];
        if (left && cur && left.key < cur.key) smallest = l;
        const best = items[smallest];
        if (right && best && right.key < best.key) smallest = r;
        if (smallest === i) break;
        const a = items[i];
        const b = items[smallest];
        if (!a || !b) break;
        items[i] = b;
        items[smallest] = a;
        i = smallest;
      }
    }
    return top;
  }
}
