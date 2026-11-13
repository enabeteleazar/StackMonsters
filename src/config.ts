// Une seule source d'adresse pour tout le front.
// Chemin RELATIF volontairement : le bundle ne doit jamais contenir
// de port ni de nom d'hôte, sinon il casse dès qu'on change d'accès.
export const API_URL = '/api'

// Mentions de la politique de confidentialité.
export const RESPONSABLE = 'NABET Eleazar'
export const CONTACT = 'contact@mail.stackmonsters.fr'
export const MISE_A_JOUR_CONFIDENTIALITE = '13 novembre 2026'

// Clé du navigateur où est gardé le jeton d'accès (voir src/api.ts).
// Nom historique conservé : le changer déconnecterait tous les utilisateurs.
export const CLE_JETON = 'canstack-jeton'

// Nombre de lectures identiques d'affilée exigées avant de valider un code.
export const LECTURES_CONFIRMATION = 2

// Taille maximale d'une photo enregistrée, en pixels sur le grand côté.
export const PHOTO_MAX = 640
