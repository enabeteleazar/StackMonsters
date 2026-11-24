/**
 * Résultat de la promesse, ou `secours` si elle n'a pas répondu dans le délai (ou a échoué) : pour qu'un appel lent
 * ne bloque pas l'interface (message d'accueil, #34 : au-delà de 3 s, on continue sans).
 */
export function avecDelai<T, S>(promesse: Promise<T>, ms: number, secours: S): Promise<T | S> {
  return new Promise((resoudre) => {
    const minuterie = setTimeout(() => resoudre(secours), ms)
    promesse.then(
      (valeur) => {
        clearTimeout(minuterie)
        resoudre(valeur)
      },
      () => {
        clearTimeout(minuterie)
        resoudre(secours)
      },
    )
  })
}
