import { describe, expect, it } from 'vitest'
import { choixValide, DUREE_CHOIX, provenanceDe } from './suivi'

const T = Date.UTC(2026, 10, 9)
const enregistre = (choix: string, date: number) => JSON.stringify({ choix, date })

describe('choixValide', () => {
  it('garde un choix récent', () => {
    expect(choixValide(enregistre('oui', T), T + 1000)).toBe('oui')
    expect(choixValide(enregistre('non', T), T + 1000)).toBe('non')
  })

  it('redemande un refus après 6 mois et un accord après 13 mois', () => {
    expect(choixValide(enregistre('non', T), T + DUREE_CHOIX.non)).toBeNull()
    expect(choixValide(enregistre('oui', T), T + DUREE_CHOIX.non)).toBe('oui')
    expect(choixValide(enregistre('oui', T), T + DUREE_CHOIX.oui)).toBeNull()
  })

  it('redemande si la valeur est absente, ancienne ou illisible', () => {
    expect(choixValide(null, T)).toBeNull()
    expect(choixValide('oui', T)).toBeNull()
    expect(choixValide(enregistre('peut-etre', T), T)).toBeNull()
    expect(choixValide('{', T)).toBeNull()
  })
})

describe('provenanceDe', () => {
  const ICI = 'stackmonsters.fr'
  const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'
  const p = (ua: string, referent = '', recherche = '') => provenanceDe(ua, referent, recherche, ICI)

  it('reconnaît TikTok : site référent, utm_source et navigateur intégré', () => {
    expect(p(CHROME, 'https://www.tiktok.com/@stackmonsters')).toBe('tiktok')
    expect(p(CHROME, 'https://vm.tiktok.com/ZMabc/')).toBe('tiktok')
    expect(p(CHROME, '', '?utm_source=TikTok&utm_medium=bio')).toBe('tiktok')
    for (const ua of [
      `${CHROME} musical_ly_2023409030 JsSdk/1.0 NetType/WIFI Channel/googleplay`,
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 BytedanceWebview/d8a21c6',
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 trill_340004 TikTok 34.0.4',
    ]) {
      expect(p(ua)).toBe('tiktok')
    }
  })

  it('priorité fixe : utm_source, puis site référent, puis navigateur intégré', () => {
    const TIKTOK_UA = `${CHROME} musical_ly_2023409030`
    const INSTA_UA = 'Mozilla/5.0 (iPhone) Instagram 312.0'
    expect(p(TIKTOK_UA, '', '?utm_source=instagram')).toBe('instagram') // l'utm l'emporte sur le navigateur
    expect(p(INSTA_UA, '', '?utm_source=tiktok')).toBe('tiktok') // dans les deux sens
    expect(p(INSTA_UA, 'https://www.tiktok.com/')).toBe('tiktok') // le référent l'emporte sur le navigateur
    expect(p(CHROME, 'https://l.facebook.com/', '?utm_source=tiktok')).toBe('tiktok') // l'utm sur le référent
    expect(p(INSTA_UA, '', '?utm_source=newsletter')).toBe('instagram') // utm inconnu : on passe à la suite
    expect(p(CHROME, 'https://www.google.com/', '?utm_source=newsletter')).toBe('other')
    expect(p(CHROME, '', '?utm_source=fb')).toBe('facebook')
    expect(p(CHROME, 'https://x.com/stackmonsters')).toBe('twitter')
    expect(p(CHROME, '', '?utm_source=x')).toBe('twitter')
  })

  it('garde les autres provenances', () => {
    expect(p('Mozilla/5.0 (iPhone) Instagram 312.0')).toBe('instagram')
    expect(p(CHROME, 'https://l.facebook.com/l.php')).toBe('facebook')
    expect(p(CHROME, 'https://t.co/abc')).toBe('twitter')
    expect(p(CHROME, 'https://www.google.com/')).toBe('other')
    expect(p(CHROME, `https://${ICI}/wiki`)).toBe('direct')
    expect(p(CHROME)).toBe('direct')
    expect(p(CHROME, 'pas une url')).toBe('direct')
  })
})
