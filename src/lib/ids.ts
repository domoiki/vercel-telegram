/** IDs and trace codes. */

/** Full-length primary key. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Short, quotable trace id, e.g. `8F3A21`. Uppercase hex, collision-checked by callers. */
export function newCorrelationId(length = 6): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, length);
}
