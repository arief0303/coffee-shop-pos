export function timestamp(): number {
  return Date.now();
}

export function identifier(): string {
  return crypto.randomUUID();
}
