export function indexByTo<T, K extends PropertyKey, V>(
  arr: readonly T[],
  getId: (item: T) => K,
  getVal: (item: T) => V,
  onDuplicate: "throw" | "first" | "last" = "last"
): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const item of arr) {
    const k = getId(item);
    if (k in out) {
      if (onDuplicate === "throw") throw new Error(`Duplicate key: ${String(k)}`);
      if (onDuplicate === "first") continue; // keep the earlier one
      // "last": fall through to overwrite
    }
    (out as Record<K, V>)[k] = getVal(item);
  }
  return out;
}

export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}