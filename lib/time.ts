export function timestamp(): number {
  return Date.now();
}

export function identifier(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
