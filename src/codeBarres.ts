function cleValide(code: string): boolean {
  const total = [...code.slice(0, -1)]
    .reverse()
    .reduce((somme, chiffre, i) => somme + Number(chiffre) * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (total % 10)) % 10 === Number(code.slice(-1))
}

/**
 * Forme canonique d'un code-barres, identique à celle du serveur : un UPC-A (12 chiffres) est complété
 * à 13 chiffres pour ne pas exister en double, un EAN-8 reste tel quel. Null si le code est invalide.
 */
export function normaliserCodeBarres(code: string): string | null {
  if (!/^(\d{8}|\d{12,13})$/.test(code) || !cleValide(code)) return null
  return code.length === 12 ? `0${code}` : code
}

/**
 * Code inventé (préfixe GS1 « 20 », usage interne) d'une fiche du Wiki dont on ignore le vrai code-barres ;
 * un scan peut le remplacer par le vrai. Même règle que le serveur (CODE_INTERNE_RE).
 */
export const estCodeInterne = (code: string) => /^20\d{11}$/.test(code)

/** Développe un UPC-E à 8 chiffres en UPC-A à 12 chiffres. */
export function upcEVersUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const [ns, x1, x2, x3, x4, x5, x6, cle] = [...code]
  let corps: string
  if ('012'.includes(x6)) corps = `${x1}${x2}${x6}0000${x3}${x4}${x5}`
  else if (x6 === '3') corps = `${x1}${x2}${x3}00000${x4}${x5}`
  else if (x6 === '4') corps = `${x1}${x2}${x3}${x4}00000${x5}`
  else corps = `${x1}${x2}${x3}${x4}${x5}0000${x6}`
  return `${ns}${corps}${cle}`
}

/** Code issu du scanner : seul le lecteur sait distinguer un UPC-E d'un EAN-8, tous deux à 8 chiffres. */
export function normaliserLecture(brut: string, format?: string): string {
  const code = format === 'upc_e' ? (upcEVersUpcA(brut) ?? brut) : brut
  return normaliserCodeBarres(code) ?? brut
}
