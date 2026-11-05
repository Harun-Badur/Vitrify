/** A Set that keeps only the most recently added `limit` values (oldest evicted first). */
export class BoundedRecentSet<T> {
  private readonly values = new Set<T>();
  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Limit must be positive');
  }
  get size(): number { return this.values.size; }
  has(value: T): boolean { return this.values.has(value); }
  add(value: T): this {
    this.values.delete(value);
    this.values.add(value);
    if (this.values.size > this.limit) this.values.delete(this.values.values().next().value as T);
    return this;
  }
  delete(value: T): boolean { return this.values.delete(value); }
}
