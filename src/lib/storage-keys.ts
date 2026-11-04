/** Format des clés de stockage (préfixe + UUID + extension) — module pur, partagé avec les scripts. */
export const STORAGE_KEY = /^(signatures|documents)\/[0-9a-f-]{36}\.(png|pdf|jpg)$/;

export function isStorageKey(key: string): boolean {
  return STORAGE_KEY.test(key);
}
