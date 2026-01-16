/**
 * ABOUTME: Object manipulation utilities for testing ralph-tui.
 * Provides common object operations: pick, omit, and deepClone.
 */

/**
 * Creates an object composed of the picked object properties.
 * @param obj - The source object
 * @param keys - The property keys to pick
 * @returns A new object with only the specified keys
 * @example
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c']) // returns { a: 1, c: 3 }
 * pick({ name: 'John', age: 30, city: 'NYC' }, ['name']) // returns { name: 'John' }
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
 * Creates an object composed of all properties except the omitted ones.
 * @param obj - The source object
 * @param keys - The property keys to omit
 * @returns A new object without the specified keys
 * @example
 * omit({ a: 1, b: 2, c: 3 }, ['b']) // returns { a: 1, c: 3 }
 * omit({ name: 'John', age: 30, city: 'NYC' }, ['age', 'city']) // returns { name: 'John' }
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Creates a deep clone of an object, copying all nested objects and arrays.
 * @param obj - The object to clone
 * @returns A deep copy of the object
 * @example
 * const original = { a: { b: 1 }, c: [1, 2] };
 * const cloned = deepClone(original);
 * cloned.a.b = 2; // original.a.b is still 1
 * cloned.c.push(3); // original.c is still [1, 2]
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}
