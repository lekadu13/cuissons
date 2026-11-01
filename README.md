# Cuissons Palle d'Oro

Suivi des cuissons d'arancini sur deux friteuses : paniers de six emplacements, minuteurs de 5 à 20 minutes, alerte, historique et sauvegarde.

Application web à ajouter à l'écran d'accueil de l'iPhone (Safari › Partager › Sur l'écran d'accueil). Fonctionne hors ligne. Les données restent sur le téléphone ; exporter régulièrement une sauvegarde depuis Réglages.

Limite : une page web ne peut pas sonner quand l'iPhone est verrouillé ou en arrière-plan. L'app garde l'écran allumé pendant les cuissons et affiche la phrase Siri pour lancer un minuteur Horloge en secours.

Tests : `node tests/test.js` (Playwright).
