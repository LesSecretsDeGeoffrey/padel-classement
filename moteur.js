// moteur.js — calculs purs du simulateur de classement padel (module ES, sans DOM).
// Mois = 'AAAA-MM', dates = 'AAAA-MM-JJ' : les comparaisons de chaînes ISO sont chronologiques.

export const TOURS = { vainqueur: 1, finale: 2, demi: 4, quart: 8, huitieme: 16, seizieme: 32 };
export const LIBELLES_TOURS = {
  vainqueur: 'Vainqueur', finale: 'Finale perdue', demi: 'Demi-finale',
  quart: 'Quart de finale', huitieme: 'Huitième', seizieme: 'Seizième',
};
export const CUTS = [['P25', 30000], ['P50', 10000], ['P100', 3000], ['P250', 800]];
export const CATEGORIES = ['P25', 'P50', 'P100', 'P250', 'P500', 'P1000', 'P1500', 'P2000'];

export function tranche(categorie, nbPaires) {
  const n = Math.max(4, Number(nbPaires) || 0);
  let t = n <= 8 ? '4-8' : n <= 12 ? '9-12' : n <= 16 ? '13-16' : n <= 20 ? '17-20'
    : n <= 24 ? '21-24' : n <= 28 ? '25-28' : '29-+';
  if (categorie === 'P25' && t === '29-+') t = '25-28';
  return t;
}

export function points(bareme, categorie, nbPaires, rang) {
  const cat = bareme.grille[categorie];
  if (!cat) throw new Error(`Catégorie inconnue : ${categorie}`);
  const t = tranche(categorie, nbPaires);
  const col = cat[t];
  if (!col) throw new Error(`${categorie} n'existe pas à ${nbPaires} paires`);
  const r = Math.min(Math.max(1, Math.trunc(Number(rang))), 32);
  const v = col[String(r)];
  if (v === undefined) throw new Error(`Rang ${rang} impossible en ${categorie} à ${nbPaires} paires`);
  return v;
}

// Rang le moins avantageux du groupe éliminé à ce tour, borné par le nombre de paires quand il est donné
// (perdre au premier tour d'un tournoi à 12 paires = 12e, pas 16e).
export function rangDepuisTour(tour, nbPaires) {
  const r = TOURS[tour];
  if (!r) throw new Error(`Tour inconnu : ${tour}`);
  const n = Math.trunc(Number(nbPaires));
  return n > 0 ? Math.min(r, n) : r;
}

export const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(s + 'T00:00:00Z');

export function premierMardi(mois) {
  const [a, m] = mois.split('-').map(Number);
  const d1 = new Date(Date.UTC(a, m - 1, 1));
  const decal = (2 - d1.getUTCDay() + 7) % 7; // 2 = mardi
  return iso(new Date(Date.UTC(a, m - 1, 1 + decal)));
}

// Dimanche qui précède le premier mardi : dernier jour de match pris en compte dans le calcul du mois.
export function finFenetre(mois) {
  const d = utc(premierMardi(mois));
  d.setUTCDate(d.getUTCDate() - 2);
  return iso(d);
}

export function moisSuivant(mois, n = 1) {
  const [a, m] = mois.split('-').map(Number);
  return iso(new Date(Date.UTC(a, m - 1 + n, 1))).slice(0, 7);
}

// Premier classement dans lequel un match joué à cette date entre.
export function moisEntree(dateTournoi) {
  let m = dateTournoi.slice(0, 7);
  for (let i = 0; i < 3; i++) {
    if (finFenetre(m) >= dateTournoi) return m;
    m = moisSuivant(m);
  }
  throw new Error(`Mois d'entrée introuvable pour ${dateTournoi}`);
}

// Un résultat compte dans 12 classements consécutifs à partir de son mois d'entrée.
export function dernierMoisValide(dateTournoi) {
  return moisSuivant(moisEntree(dateTournoi), 11);
}

export function libelleMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  return `${MOIS_FR[m - 1]} ${a}`;
}

// Pour un résultat importé de Ten'Up, `valableJusqua` fait foi ; sinon on le déduit de la date.
export function estValide(r, mois) {
  const fin = r.valableJusqua || dernierMoisValide(r.date);
  return moisEntree(r.date) <= mois && mois <= fin;
}

export function resultatsValides(resultats, mois) {
  return resultats.filter(r => estValide(r, mois));
}

// Tri par points décroissants puis date décroissante (ordre Ten'Up) ; 12 retenus.
export function totalMois(resultats, mois) {
  const tries = resultatsValides(resultats, mois).slice()
    .sort((x, y) => y.points - x.points || (x.date > y.date ? -1 : x.date < y.date ? 1 : 0));
  const retenus = tries.slice(0, 12);
  const nonRetenus = tries.slice(12);
  return { total: retenus.reduce((s, r) => s + r.points, 0), retenus, nonRetenus };
}

// `table` = liste [points, classement, effectif] triée par points décroissants (joueurs non assimilés).
// Escalier : le classement d'une valeur absente est celui de la première valeur inférieure présente.
export function rang(pts, table) {
  if (!(pts > 0) || !table.length) return null;
  for (const [p, c] of table) if (p <= pts) return c;
  return table[table.length - 1][1];
}

// Plus petite valeur de points de la table dont le classement est ≤ la cible ; null si aucune.
export function pointsPourClassement(cible, table) {
  for (let i = table.length - 1; i >= 0; i--) if (table[i][1] <= cible) return table[i][0];
  return null;
}

export function categoriesInterdites(classement) {
  if (!classement) return [];
  return CUTS.filter(([, cut]) => classement <= cut).map(([c]) => c);
}

// Pour chaque mois à partir de moisDepart : total, classement, retenus, ce qui sort, ce qui entre,
// et la perte nette (total du mois précédent − total du mois sans les nouveaux entrants).
export function projection(resultatsReels, simulations, moisDepart, table, nbMois = 12) {
  const tous = [
    ...resultatsReels.map(r => ({ ...r, simule: false })),
    ...simulations.map(s => ({ ...s, simule: true })),
  ];
  const lignes = [];
  let prec = null;
  for (let i = 0; i < nbMois; i++) {
    const mois = moisSuivant(moisDepart, i);
    const valides = resultatsValides(tous, mois);
    const { total, retenus, nonRetenus } = totalMois(valides, mois);
    const expires = prec ? prec.valides.filter(r => !valides.includes(r)) : [];
    const entrants = prec ? valides.filter(r => !prec.valides.includes(r)) : [];
    const sansEntrants = valides.filter(r => !entrants.includes(r));
    const perteNette = prec ? Math.max(0, prec.total - totalMois(sansEntrants, mois).total) : 0;
    const ligne = { mois, total, classement: rang(total, table), retenus, nonRetenus, expires, entrants, perteNette, valides };
    lignes.push(ligne);
    prec = ligne;
  }
  return lignes.map(({ valides, ...l }) => l);
}

// Quand un classement plus récent arrive, les simulations datées jusqu'à sa fin de fenêtre
// sont couvertes par les vrais résultats (ou n'ont pas eu lieu) : on les retire.
export function purgerSimulations(simulations, nouveauMois) {
  const fin = finFenetre(nouveauMois);
  return {
    gardees: simulations.filter(s => s.date > fin),
    supprimees: simulations.filter(s => s.date <= fin),
  };
}
