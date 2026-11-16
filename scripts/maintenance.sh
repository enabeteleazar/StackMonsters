#!/usr/bin/env bash
# Active ou désactive le mode maintenance du site en production.
#
#   scripts/maintenance.sh                        choix MAINTENANCE / PRODUCTION, puis redéploiement
#   SIMULATION=1 scripts/maintenance.sh           affiche les commandes Vercel sans rien modifier
#   SANS_REDEPLOIEMENT=1 scripts/maintenance.sh   change seulement la variable (jour de release : le
#                                                 vercel --prod de la nouvelle version la prendra en compte)
#
# STATUS_APP est lue au build (vite.config.ts) : changer la variable ne suffit pas, il faut reconstruire le site.
# Le script reconstruit le DERNIER déploiement de production (vercel redeploy) : le code en ligne ne change pas,
# seul le mode change. Pour livrer une nouvelle version, c'est vercel --prod (après les migrations).

set -Eeuo pipefail

# Racine du projet (dossier .vercel), d'où que le script soit lancé.
cd "$(dirname "$0")/.."

VARIABLE="STATUS_APP"
ENV="production"

simulation() { [[ "${SIMULATION:-0}" == "1" ]]; }

# Commande Vercel qui modifie quelque chose : lancée, ou seulement affichée en simulation.
vercel_modifie() {
    if simulation; then
        echo "[simulation] vercel $*"
    else
        vercel "$@"
    fi
}

[[ -t 1 ]] && clear 2>/dev/null || true

echo "======================================"
echo "       STACKMONSTERS — MAINTENANCE"
echo "======================================"
simulation && echo "        (simulation : rien n'est modifié)"

if ! command -v vercel >/dev/null 2>&1; then
    echo "ERREUR : Vercel CLI n'est pas installé (npm i -g vercel)."
    exit 1
fi

# Lien avec le projet : project.json (vercel link) ou repo.json (lien par dépôt Git, cas de ce projet).
if [[ ! -f ".vercel/project.json" && ! -f ".vercel/repo.json" ]]; then
    echo "ERREUR : aucun projet Vercel lié à ce dossier."
    echo "Lance d'abord, à la racine du projet : vercel link"
    exit 1
fi

echo ""
echo "Compte Vercel :"
if ! vercel whoami; then
    echo "ERREUR : non connecté. Lance d'abord : vercel login"
    exit 1
fi

echo ""
echo "--------------------------------------"
echo "Mode du site en production"
echo "--------------------------------------"
echo "1) MAINTENANCE  (page de maintenance à la place de l'appli)"
echo "2) PRODUCTION   (appli normale)"
echo ""
read -rp "Choix [1-2] : " CHOIX

case "$CHOIX" in
    1) VALEUR="MAINTENANCE" ;;
    2) VALEUR="PRODUCTION" ;;
    *)
        echo "Choix invalide : rien n'a été modifié."
        exit 1
        ;;
esac

echo ""
echo "--------------------------------------"
echo "1. $VARIABLE = $VALEUR ($ENV)"
echo "--------------------------------------"

# Remplacement en une opération (--force). Réglage lisible, pas un secret (--no-sensitive) ; --yes : aucune
# question de la CLI. Si Vercel refuse de transformer l'ancienne variable « secret » en réglage, elle est
# retirée puis recréée (sans variable, le build vaut PRODUCTION, et rien n'est redéployé en cas d'échec).
ecrire() {
    if simulation; then
        echo "[simulation] echo $VALEUR | vercel env add $VARIABLE --environment $ENV --no-sensitive --force --yes"
        return 0
    fi
    printf '%s' "$VALEUR" | vercel env add "$VARIABLE" --environment "$ENV" --no-sensitive --force --yes
}

if ! ecrire; then
    echo "Remplacement refusé : suppression de l'ancienne variable, puis nouvel essai..."
    vercel_modifie env rm "$VARIABLE" --environment "$ENV" --yes || true
    if ! ecrire; then
        echo "ERREUR : $VARIABLE n'a pas pu être enregistrée. Rien n'est redéployé."
        echo "Le site en ligne ne change pas ; sans variable, le prochain build serait en PRODUCTION."
        exit 1
    fi
fi
echo "$VARIABLE enregistrée : $VALEUR."

if [[ "${SANS_REDEPLOIEMENT:-0}" == "1" ]]; then
    echo ""
    echo "Redéploiement non lancé (SANS_REDEPLOIEMENT=1) : le site en ligne ne change pas."
    echo "Le mode $VALEUR s'appliquera au prochain déploiement de production (vercel --prod)."
    exit 0
fi

echo ""
echo "--------------------------------------"
echo "2. REDÉPLOIEMENT DE LA PRODUCTION"
echo "--------------------------------------"

# Dernier déploiement de production en ligne (le plus récent en tête de liste).
DERNIER="$(vercel list --environment production --status READY 2>/dev/null |
    grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | head -1 || true)"

if [[ -z "$DERNIER" ]]; then
    echo "Aucun déploiement de production trouvé : lance vercel --prod pour publier le site."
    exit 1
fi

echo "Reconstruction de $DERNIER avec $VARIABLE=$VALEUR (même code, nouveau mode)..."
if ! vercel_modifie redeploy "$DERNIER" --environment production; then
    echo "ERREUR : le redéploiement a échoué. La variable est enregistrée :"
    echo "relance « vercel redeploy $DERNIER --environment production » ou « Redeploy » dans le tableau de bord."
    exit 1
fi

echo ""
echo "======================================"
if [[ "$VALEUR" == "MAINTENANCE" ]]; then
    echo "  Site en MAINTENANCE."
else
    echo "  Site en PRODUCTION."
fi
echo "======================================"
echo "Les téléphones qui ont installé l'appli voient le changement à la prochaine ouverture avec le réseau."
