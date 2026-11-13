// Le mouvement de l'appli : un ressort qu'on peut rattraper et renvoyer à tout instant, la vitesse du doigt
// au lâcher, la projection de l'élan et la résistance élastique en butée. Aucune dépendance, marche hors ligne.
// Repères (Apple, « Designing Fluid Interfaces ») : amortissement 1 = pas de rebond, 0,8 = léger rebond
// (seulement après un geste lancé) ; réponse = vivacité en secondes, pas une durée.

const borner = (n, min, max) => Math.min(max, Math.max(min, n));

// Ressort à solution exacte : chaque pas repart de la position ET de la vitesse en cours, donc changer `cible`
// en plein vol ne produit aucun saut, et la trajectoire ne dépend pas du rythme des images.
export function creerRessort({ valeur = 0, cible = valeur, vitesse = 0, amortissement = 1, reponse = 0.35, precision = 0.5 } = {}) {
  const r = { valeur, cible, vitesse, amortissement, reponse, precision };
  r.auRepos = () => Math.abs(r.cible - r.valeur) < r.precision && Math.abs(r.vitesse) < r.precision * 20;
  r.avancer = (dt) => {
    const zeta = borner(r.amortissement, 0.1, 1);
    const omega = (2 * Math.PI) / Math.max(0.05, r.reponse);
    const a = r.valeur - r.cible, v0 = r.vitesse;
    if (zeta >= 1) {
      const b = v0 + omega * a, e = Math.exp(-omega * dt);
      r.valeur = r.cible + (a + b * dt) * e;
      r.vitesse = (b - omega * (a + b * dt)) * e;
    } else {
      const od = omega * Math.sqrt(1 - zeta * zeta), c = (v0 + zeta * omega * a) / od;
      const e = Math.exp(-zeta * omega * dt), cos = Math.cos(od * dt), sin = Math.sin(od * dt);
      r.valeur = r.cible + e * (a * cos + c * sin);
      r.vitesse = e * ((od * c - zeta * omega * a) * cos - (od * a + zeta * omega * c) * sin);
    }
    return r.auRepos();
  };
  return r;
}

// Où le geste s'arrêterait tout seul (même loi que le défilement) : on choisit la cible d'après ce point,
// pas d'après l'endroit du lâcher. vitesse en px/s, résultat en px.
export function projeter(vitesse, deceleration = 0.998) {
  return (vitesse / 1000) * deceleration / (1 - deceleration);
}

// Au-delà d'une butée, l'élément suit de moins en moins au lieu de s'arrêter net.
export function elastique(depassement, dimension, constante = 0.55) {
  return (depassement * dimension * constante) / (dimension + constante * Math.abs(depassement));
}

// Vitesse du doigt, mesurée sur les dernières millisecondes seulement (un doigt resté posé vaut 0).
export function creerSuiviVitesse(fenetreMs = 100) {
  const points = [];
  return {
    ajouter(valeur, t) {
      points.push([valeur, t]);
      while (points.length > 2 && t - points[0][1] > fenetreMs) points.shift();
    },
    vitesse() {
      if (points.length < 2) return 0;
      const [x1, t1] = points[points.length - 1];
      const dedans = points.filter(([, t]) => t1 - t <= fenetreMs);
      if (dedans.length < 2) return 0;
      const [x0, t0] = dedans[0];
      return t1 === t0 ? 0 : ((x1 - x0) / (t1 - t0)) * 1000;
    },
  };
}

// Fait vivre un ressort à l'écran. `immediat()` vrai (mouvements réduits) = on pose la valeur sans trajet.
export function animer(ressort, appliquer, { immediat = () => false } = {}) {
  let id = 0, dernier = 0, fin = null;
  const tic = (t) => {
    // solution exacte, donc stable quel que soit l'écart entre deux images : si l'écran rame, le mouvement
    // saute des images mais finit à l'heure (borne à 0,5 s pour un retour d'arrière-plan)
    const dt = dernier ? Math.min(0.5, (t - dernier) / 1000) : 1 / 60;
    dernier = t;
    const repos = ressort.avancer(dt);
    if (repos) { ressort.valeur = ressort.cible; ressort.vitesse = 0; }
    appliquer(ressort.valeur);
    if (!repos) { id = requestAnimationFrame(tic); return; }
    id = 0;
    const f = fin; fin = null;
    if (f) f();
  };
  const pilote = {
    vers(cible, { vitesse, amortissement, reponse, apres } = {}) {
      if (immediat()) { pilote.poser(cible); if (apres) apres(); return; }
      ressort.cible = cible;
      if (vitesse !== undefined) ressort.vitesse = vitesse;
      if (amortissement !== undefined) ressort.amortissement = amortissement;
      if (reponse !== undefined) ressort.reponse = reponse;
      fin = apres || null;
      if (!id) { dernier = 0; id = requestAnimationFrame(tic); }
    },
    poser(valeur) {
      pilote.arreter();
      ressort.valeur = ressort.cible = valeur; ressort.vitesse = 0;
      appliquer(valeur);
    },
    arreter() { if (id) cancelAnimationFrame(id); id = 0; fin = null; },
    get enCours() { return id !== 0; },
  };
  return pilote;
}
