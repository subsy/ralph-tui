/**
 * ABOUTME: Object manipulation utilities for testing ralph-tui.
 * Provides common object operations: pick, omit, and deepClone.
 */

/**
 * Creates a new object with only the specified keys from the source object.
 * Keys that don't exist in the source object are silently ignored.
 *
 * @typeParam T - The type of the source object
 * @typeParam K - The keys to pick (must be keys of T)
 * @param obj - The source object to pick keys from
 * @param keys - An array of keys to include in the new object
 * @returns A new object containing only the specified keys
 * @example
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // returns { a: 1, c: 3 }
 * pick({ name: 'Alice', age: 30 }, ['name']) // returns { name: 'Alice' }
 * pick({ a: 1 }, []) // returns {}
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Creates a new object with the specified keys removed from the source object.
 * Keys that don't exist in the source object are silently ignored.
 *
 * @typeParam T - The type of the source object
 * @typeParam K - The keys to omit (must be keys of T)
 * @param obj - The source object to omit keys from
 * @param keys - An array of keys to exclude from the new object
 * @returns A new object with the specified keys removed
 * @example
 * omit({ a: 1, b: 2, c: 3 }, ['b']) // returns { a: 1, c: 3 }
 * omit({ name: 'Alice', age: 30, city: 'NYC' }, ['age', 'city']) // returns { name: 'Alice' }
 * omit({ a: 1 }, []) // returns { a: 1 }
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const keysToOmit = new Set(keys);
  const result = {} as Omit<T, K>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (!keysToOmit.has(key as K)) {
      (result as T)[key] = obj[key];
    }
  }
  return result;
}

/**
 * Creates a deep copy of an object, including nested objects and arrays.
 * Handles primitives, plain objects, arrays, Date objects, and null/undefined.
 * Does not handle circular references, functions, or class instances with methods.
 *
 * @typeParam T - The type of the value to clone
 * @param value - The value to deep clone
 * @returns A deep copy of the value
 * @example
 * deepClone({ a: { b: 1 } }) // returns { a: { b: 1 } } (separate object)
 * deepClone([1, [2, 3]]) // returns [1, [2, 3]] (separate array)
 * deepClone(new Date('2024-01-01')) // returns new Date('2024-01-01')
 * deepClone(null) // returns null
 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
