export function estCodeBarresEAN13(code: string): boolean {
  return /^\d{13}$/.test(code)
}
