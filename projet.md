# Cyberlove — Définition du besoin + architecture proposée

## Définition du besoin (à l'identique)

Nous allons créer un jeu vidéo en 3D webgl pour mobile + IA pour intéraction avec les PNJ.

### Titre

Cyberlove

### Objectif

marcher dans un ville cyberpunk, dans foule d'individus inconnus, et tenter de détecter sa future moitié

### Environnement 3D
- Le personnage avance sur une passerelle flottante au-dessus du vide entre des bâtiments d'une hauteur vertigineuse.
- Formes simples pour l'architecture : simples pavés droits mais avec textures + néon + glow pour l'anbiance cyber
- Voir screenshot pour la vue d'ensemble
- Le personnage avancera sur la passerelle principale qu'on voit dans le screenshot

### Génération procédurale
- la ville est immense, donc on ne doit pas charger toute la scène
- la vision est limitée par du fog
- la ville est générée quand on avance par un algo pseuo-random pour pouvoir générer les mêmes bâtiments en fonction de la position sur la map
- la passerelle est droite, on ne peut qu'avancer ou reculer dessus, et se déplacer en sur la largeur
- la passerelle est assez largeur pour un flux de 10 lignes de piétons
- à certains endroits, il y a des petits stands de commerçants (symbolisés par des parallélépipèdes simples pour commencer)

### Génération de la foule
- chaque passant est un cube
- chaque passant se déplace dans un sens ou l'autre sur une passerelle, mais l'algo doit permettre aux cubes de s'éviter pour ne pas collisionner, pour donner un véritable aspect "foule"

### Caméra et déplacements
- le personnage principal est simulé par un simple cube pour commencer, de même que les passants
- par défaut, la caméra est derrière le personnage, légèrement au-dessus
- on peut faire tourner la caméra tout autour du personnage (clic droite souris + bouger)

Proposer l'architecture du projet pour :
- gérer la scène en 3D, les textures, le fog, les effets de glow pour l'ambiance cyber
- gérer la génération procédurale (simple) de la ville en pseudo-random
- gérer la foule et le déplacement des piétons (cubes) de manière naturelle
- gérer le déplacement du personnage et la caméra libre autour de lui

## Architecture proposée

### 1) Stack technique
- `Three.js` (WebGL) pour rendu 3D.
- `TypeScript` pour structure claire.
- `Vite` pour build/dev.
- `three/examples/jsm/postprocessing` pour `Bloom` (glow néon) + `FogExp2`.
- `WebWorker` pour génération procédurale et logique foule hors thread UI.
- Backend léger (`Node.js`) pour IA PNJ (LLM/API), communication via `WebSocket`.

### 2) Structure projet
- `src/core/` : moteur runtime (game loop, ECS simple, time, events).
- `src/render/` : scène, lumières, matériaux, fog, postprocess glow.
- `src/world/` : génération procédurale (chunks, seed, bâtiments, passerelle, stands).
- `src/crowd/` : spawn, navigation foule, évitement collisions.
- `src/player/` : contrôles joueur (avance/recule + largeur passerelle).
- `src/camera/` : caméra 3e personne orbitale (touch + souris clic droit).
- `src/ai/` : PNJ mémoire locale + client websocket vers service IA.
- `src/assets/` : textures (tiling), LUT néon, configs.
- `src/config/` : constantes gameplay/perf mobile.

### 3) Découpage monde procédural
- Monde en `chunks` 1D le long de la passerelle (axe Z), ex. 40–60m/chunk.
- Génération déterministe avec `seed global + chunkIndex` (`hash` pseudo-random).
- Chaque chunk contient:
  - segment de passerelle,
  - façades/blocs bâtiments gauche/droite (pavés texturés),
  - probabilité de stand commerçant.
- Streaming:
  - garder `N` chunks devant + `M` derrière,
  - recycler meshes (pool) au lieu de créer/détruire en boucle.
- Fog masque la limite de génération et renforce ambiance.

### 4) Foule (cubes) naturelle et scalable
- Passants gérés en coordonnées “passerelle”: `s` (longitudinal), `x` (latéral), direction ±.
- Passerelle découpée en 10 lignes; chaque agent a une ligne préférée.
- Évitement local:
  - grille spatiale 2D (`s,x`) pour voisins proches,
  - freinage si agent devant trop proche,
  - changement de ligne temporaire si libre,
  - retour progressif vers ligne cible.
- Rendu optimisé via `InstancedMesh` (1 draw call par type).

### 5) Joueur + caméra
- Joueur cube contraint au plan passerelle:
  - `W/S` ou stick virtuel: avance/recule,
  - `A/D` ou glissement: déplacement latéral borné aux bords.
- Caméra:
  - follow derrière/au-dessus par défaut,
  - orbit libre autour du joueur (clic droit + drag, ou geste 1 doigt/2 doigts sur mobile),
  - collision caméra simplifiée (distance min/max, lissage).

### 6) IA PNJ (interaction)
- Chaque PNJ interactif a:
  - `profile` (traits, style, objectifs),
  - `memory` courte session,
  - `compatibilityScore` caché avec le joueur.
- Pipeline:
  - client envoie contexte compact (PNJ, historique court, état scène),
  - service IA génère réponse + intention + variation émotionnelle,
  - fallback local (répliques template) si latence/réseau.
- Le gameplay “future moitié” repose sur signaux progressifs (dialogue, micro-comportements, compatibilité).

### 7) Priorités perf mobile
- Instancing massif (bâtiments répétitifs + foule cubes).
- LOD simple par distance/fog.
- Textures compressées et atlases.
- Tick foule à fréquence réduite (ex. 20 Hz) + interpolation visuelle à 60 FPS.
- Culling agressif hors frustum.

Si tu veux, je peux te donner ensuite un squelette concret de code (`TypeScript + Three.js`) avec ces modules et un premier “vertical slice” jouable.
