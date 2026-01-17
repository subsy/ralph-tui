/**
 * ABOUTME: Math utilities for testing ralph-tui.
 * Provides basic arithmetic operations: add, subtract, and multiply.
 */

/**
 * Adds two numbers together.
 * @param a - The first number
 * @param b - The second number
 * @returns The sum of a and b
 * @example
 * add(2, 3) // returns 5
 * add(-1, 1) // returns 0
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts the second number from the first.
 * @param a - The number to subtract from
 * @param b - The number to subtract
 * @returns The difference of a minus b
 * @example
 * subtract(5, 3) // returns 2
 * subtract(1, 4) // returns -3
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * Multiplies two numbers together.
 * @param a - The first number
 * @param b - The second number
 * @returns The product of a and b
 * @example
 * multiply(3, 4) // returns 12
 * multiply(-2, 5) // returns -10
 */
export function multiply(a: number, b: number): number {
  return a * b;
}
