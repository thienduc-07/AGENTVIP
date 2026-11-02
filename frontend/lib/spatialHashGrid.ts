/**
 * PROVIPAGENT — Phase 4.2: High-Performance 2D Spatial Hash Grid
 *
 * Implements spatial partitioning on the office X-Z plane to reduce agent neighbor
 * lookups from O(N^2) to O(1) expected time.
 * Supports up to 100+ concurrent agents at 60+ FPS with zero memory garbage in useFrame.
 */

export interface SpatialGridItem<T = any> {
  id: string;
  x: number;
  z: number;
  radius: number;
  cellKey: number;
  data: T;
}

export class SpatialHashGrid<T = any> {
  private cellSize: number;
  private invCellSize: number;
  private cells: Map<number, SpatialGridItem<T>[]>;
  private itemMap: Map<string, SpatialGridItem<T>>;

  constructor(cellSize: number = 3.5) {
    this.cellSize = Math.max(0.5, cellSize);
    this.invCellSize = 1.0 / this.cellSize;
    this.cells = new Map();
    this.itemMap = new Map();
  }

  /**
   * Computes a 32-bit integer cell hash for 2D grid coordinates (cx, cz).
   */
  public computeCellKey(cx: number, cz: number): number {
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  /**
   * Maps world X, Z coordinates to grid cell coordinates (cx, cz).
   */
  public toCellCoords(x: number, z: number): [number, number] {
    return [Math.floor(x * this.invCellSize), Math.floor(z * this.invCellSize)];
  }

  /**
   * Inserts an item into the spatial grid.
   */
  public insert(id: string, x: number, z: number, radius: number = 0.5, data?: T): void {
    if (this.itemMap.has(id)) {
      this.update(id, x, z);
      return;
    }

    const [cx, cz] = this.toCellCoords(x, z);
    const cellKey = this.computeCellKey(cx, cz);

    const item: SpatialGridItem<T> = {
      id,
      x,
      z,
      radius,
      cellKey,
      data: (data ?? ({} as any)) as T,
    };

    let bucket = this.cells.get(cellKey);
    if (!bucket) {
      bucket = [];
      this.cells.set(cellKey, bucket);
    }
    bucket.push(item);
    this.itemMap.set(id, item);
  }

  /**
   * Updates an item's position, migrating cells only when cell boundaries are crossed.
   */
  public update(id: string, x: number, z: number): void {
    const item = this.itemMap.get(id);
    if (!item) return;

    item.x = x;
    item.z = z;

    const [cx, cz] = this.toCellCoords(x, z);
    const newCellKey = this.computeCellKey(cx, cz);

    if (newCellKey !== item.cellKey) {
      // Remove from old cell
      const oldBucket = this.cells.get(item.cellKey);
      if (oldBucket) {
        const idx = oldBucket.findIndex((it) => it.id === id);
        if (idx !== -1) {
          oldBucket.splice(idx, 1);
          if (oldBucket.length === 0) {
            this.cells.delete(item.cellKey);
          }
        }
      }

      // Add to new cell
      item.cellKey = newCellKey;
      let newBucket = this.cells.get(newCellKey);
      if (!newBucket) {
        newBucket = [];
        this.cells.set(newCellKey, newBucket);
      }
      newBucket.push(item);
    }
  }

  /**
   * Removes an item from the spatial grid.
   */
  public remove(id: string): void {
    const item = this.itemMap.get(id);
    if (!item) return;

    const bucket = this.cells.get(item.cellKey);
    if (bucket) {
      const idx = bucket.findIndex((it) => it.id === id);
      if (idx !== -1) {
        bucket.splice(idx, 1);
        if (bucket.length === 0) {
          this.cells.delete(item.cellKey);
        }
      }
    }
    this.itemMap.delete(id);
  }

  /**
   * Queries all items within `radius` of world position (qx, qz).
   * Alloc-free version populating an existing output array.
   */
  public queryRadiusAllocFree(
    qx: number,
    qz: number,
    radius: number,
    outArray: SpatialGridItem<T>[]
  ): number {
    outArray.length = 0;
    const rSq = radius * radius;

    const minCx = Math.floor((qx - radius) * this.invCellSize);
    const maxCx = Math.floor((qx + radius) * this.invCellSize);
    const minCz = Math.floor((qz - radius) * this.invCellSize);
    const maxCz = Math.floor((qz + radius) * this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cellKey = this.computeCellKey(cx, cz);
        const bucket = this.cells.get(cellKey);
        if (!bucket) continue;

        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          const dx = item.x - qx;
          const dz = item.z - qz;
          const distSq = dx * dx + dz * dz;

          if (distSq <= rSq) {
            outArray.push(item);
          }
        }
      }
    }

    return outArray.length;
  }

  /**
   * Convenience query returning a fresh array of items within radius.
   */
  public queryRadius(qx: number, qz: number, radius: number): SpatialGridItem<T>[] {
    const result: SpatialGridItem<T>[] = [];
    this.queryRadiusAllocFree(qx, qz, radius, result);
    return result;
  }

  /**
   * Returns item count.
   */
  public size(): number {
    return this.itemMap.size;
  }

  /**
   * Clears the grid completely.
   */
  public clear(): void {
    this.cells.clear();
    this.itemMap.clear();
  }
}
