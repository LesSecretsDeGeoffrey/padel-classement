// Interface v2 : un seul écran, mis à jour élément par élément (plus de page réécrite d'un bloc).
// Les calculs restent dans moteur.js, les données dans data/. Le mouvement vient de fluide.js.
import * as M from '../moteur.js';
import { creerRessort, animer, projeter, elastique, creerSuiviVitesse } from './fluide.js';

const DONNEES = '../data';
const $ = (s, r = document) => r.querySelector(s);
const CLE_SIMU = 'padel.simulations';
const CLE_MOIS = 'padel.dernierMoisVu';
const MOIS_AXE = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
const MOIS_TXT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const etat = { bareme: null, joueur: null, table: null, simulations: [], ajout: null, proj: [], sans: [], survol: null };
let premierRendu = true; // à l'ouverture, tout est posé d'emblée : seuls les changements s'animent

const calme = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MVT = { immediat: calme };
const borner = (n, min, max) => Math.min(max, Math.max(min, n));
const r1 = (n) => Math.round(n * 10) / 10;
// garder le geste même si le doigt sort de l'élément ; un pointeur déjà relâché ne doit pas casser le geste
const capturer = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointeur déjà relâché */ } };

const nb = (n) => n == null ? '–' : new Intl.NumberFormat('fr-FR').format(n).replace(/\u202f/g, '\u00a0');
const rangTxt = (c) => c == null ? 'non classé' : `${nb(c)}e`;
const ordinal = (n) => `${n}${n === 1 ? 'er' : 'e'}`;
const dateFr = (d) => d.split('-').reverse().join('/');
const signe = (n) => n > 0 ? `+${nb(n)}` : n < 0 ? `−${nb(-n)}` : '0';
const pluriel = (n, un, plus) => n > 1 ? plus : un;
const echap = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// « de septembre 2026 » mais « d'octobre 2026 », « d'avril », « d'août »
const deMois = (mois) => { const l = M.libelleMois(mois); return /^[aeiouy]/.test(l) ? `d'${l}` : `de ${l}`; };
const moisCourt = (mois) => `${MOIS_TXT[Number(mois.slice(5)) - 1]} ${mois.slice(0, 4)}`;
// « 30 oct. » dans l'année du classement, « 22 déc. 2025 » sinon
const dateCourte = (d) => {
  const [a, m, j] = d.split('-').map(Number);
  return `${j === 1 ? '1er' : j} ${MOIS_TXT[m - 1]}${a !== Number(etat.joueur.mois.slice(0, 4)) ? ` ${a}` : ''}`;
};
// Nom de l'épreuve sans la catégorie répétée en fin, et sans capitales criées (« JOURNEE KAISER PADEL P100 »)
const titreEpreuve = (r) => {
  let t = (r.epreuve || '').replace(new RegExp(`\\s*${r.categorie}$`), '').trim() || r.categorie;
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, avant, lettre) => avant + lettre.toUpperCase());
  return t;
};

function lireLocal(cle, defaut) { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; } }
function ecrireLocal(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible */ } }
function sauverSimulations() { ecrireLocal(CLE_SIMU, etat.simulations); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 4200);
}

// Un nombre qui défile jusqu'à sa valeur ; changer de cible en route repart de la valeur affichée.
function nombreVivant(el, reponse = 0.5) {
  const r = creerRessort({ reponse, precision: 0.5 });
  const p = animer(r, (v) => { el.textContent = nb(Math.round(v)); }, MVT);
  let connu = false;
  return {
    vers(n, rep = reponse) { if (connu) p.vers(n, { reponse: rep }); else { connu = true; p.poser(n); } },
    depuis(a, n) { connu = true; p.poser(a); p.vers(n, { reponse }); },
    oublier() { connu = false; p.arreter(); },
  };
}

// ---------- Chargement ----------
async function chargerJson(chemin) {
  const r = await fetch(chemin, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`);
  return r.json();
}

async function charger() {
  const { mois } = await chargerJson(`${DONNEES}/dernier.json`);
  const [bareme, joueur, cl] = await Promise.all([
    chargerJson(`${DONNEES}/bareme.json`), chargerJson(`${DONNEES}/joueur/${mois}.json`), chargerJson(`${DONNEES}/classement/${mois}.json`),
  ]);
  etat.bareme = bareme; etat.joueur = joueur; etat.table = cl.table;
  etat.simulations = lireLocal(CLE_SIMU, []);

  // Nouveau mois de classement : les tournois ajoutés couverts par la fenêtre sont remplacés par les vrais résultats.
  const dernierVu = lireLocal(CLE_MOIS, null);
  if (dernierVu && joueur.mois > dernierVu) {
    const { gardees, supprimees } = M.purgerSimulations(etat.simulations, joueur.mois);
    if (supprimees.length) {
      const s = pluriel(supprimees.length, '', 's');
      etat.simulations = gardees; sauverSimulations();
      toast(`Nouveau classement ${deMois(joueur.mois)} chargé : ${supprimees.length} tournoi${s} ajouté${s} remplacé${s} par tes vrais résultats`);
    }
  }
  ecrireLocal(CLE_MOIS, joueur.mois);
  importerDepuisLien();

  etat.ajout = { date: samediProchain(), categorie: 'P100', paires: 16, tour: 'quart', rang: 8 };
  $('#pied-note').textContent = `Barème FFT du guide 2027, en vigueur depuis le ${dateFr(bareme.enVigueurDepuis)} · relevé le ${dateFr(joueur.releveLe)}`;
  // à l'ouverture, le rang défile du classement du mois dernier à celui de ce mois-ci
  if (joueur.classement != null) vivRang.depuis(joueur.classement + (joueur.evolution || 0), joueur.classement);
  toutMettreAJour();
}

function importerDepuisLien() {
  const m = location.hash.match(/#simu=([^&]+)/);
  if (!m) return;
  try {
    const simus = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (Array.isArray(simus) && confirm(`Remplacer tes ${etat.simulations.length} tournoi(s) ajouté(s) par les ${simus.length} du lien ?`)) {
      etat.simulations = simus; sauverSimulations(); toast('Tournois importés');
    }
  } catch { toast('Lien de sauvegarde illisible'); }
  history.replaceState(null, '', location.pathname + location.search);
}

function toutMettreAJour() {
  const j = etat.joueur;
  etat.proj = M.projection(j.resultats, etat.simulations, j.mois, etat.table, 12);
  etat.sans = etat.simulations.length ? M.projection(j.resultats, [], j.mois, etat.table, 12) : etat.proj;
  majHero(); majProjete(); majCourbe(); majInfo(); majListe();
  $('#tout-effacer').hidden = !etat.simulations.length;
}

// ---------- Le rang ----------
const vivRang = nombreVivant($('#h-rang'), 0.55);
$('#h-projete').innerHTML = '<span id="pj-avant"></span><b id="pj-gras"><span id="pj-rang"></span>e</b><span id="pj-apres"></span>';
const vivProjete = nombreVivant($('#pj-rang'), 0.6);

function majHero() {
  const j = etat.joueur, l = etat.survol ? etat.proj[etat.survol] : null;
  const rang = l ? l.classement : j.classement;
  const ecart = l ? (rang != null && j.classement != null ? j.classement - rang : null) : j.evolution;
  $('#h-mois').textContent = l ? `${M.libelleMois(l.mois)} · estimation` : M.libelleMois(j.mois);
  $('#haut-rang').textContent = rangTxt(rang);
  $('#haut-mois').textContent = l ? `${M.libelleMois(l.mois)} · estimation` : M.libelleMois(j.mois);
  $('#h-e').hidden = rang == null;
  if (rang == null) { vivRang.oublier(); $('#h-rang').textContent = '–'; } else vivRang.vers(rang, etat.survol === null ? 0.55 : 0.2);
  const evo = $('#h-evo');
  evo.hidden = ecart == null;
  if (ecart != null) {
    evo.textContent = `${signe(ecart)} place${pluriel(Math.abs(ecart), '', 's')}${l ? '' : ' ce mois-ci'}`;
    evo.className = `pastille${ecart < 0 ? ' neg' : ecart === 0 ? ' neutre' : ''}`;
  }
  $('#h-detail').textContent = l
    ? `${nb(l.total)} point${pluriel(l.total, '', 's')}`
    : `${nb(j.points)} points · ligue ${rangTxt(j.positionnement.ligue[0])} · ${nb(j.positionnement.france[1])} classés`;
}

// Sous le rang, quand il y a des tournois ajoutés : où ils t'emmènent, au premier mois où ils comptent.
function majProjete() {
  const n = etat.simulations.length, pli = $('#h-pli');
  if (!n) { pli.classList.add('ferme'); vivProjete.oublier(); return; }
  const k = etat.proj.findIndex(l => l.retenus.some(r => r.simule));
  const gras = $('#pj-gras');
  if (k < 0 || etat.proj[k].classement == null) {
    gras.hidden = true; $('#pj-apres').textContent = '';
    $('#pj-avant').textContent = n > 1
      ? `Tes ${n} tournois ajoutés n'entrent pas dans tes 12 meilleurs résultats sur les 12 prochains mois`
      : `Ton tournoi ajouté n'entre pas dans tes 12 meilleurs résultats sur les 12 prochains mois`;
  } else {
    const avec = etat.proj[k], sans = etat.sans[k];
    const places = sans.classement != null ? sans.classement - avec.classement : null;
    gras.hidden = false;
    $('#pj-avant').textContent = n > 1 ? `Avec tes ${n} tournois ajoutés : ` : 'Avec ton tournoi ajouté : ';
    $('#pj-apres').textContent = ` au classement ${deMois(avec.mois)}, ${nb(avec.total)} points${places ? ` (${signe(places)} place${pluriel(Math.abs(places), '', 's')})` : ''}`;
    if (pli.classList.contains('ferme') && sans.classement != null && !premierRendu) vivProjete.depuis(sans.classement, avec.classement);
    else vivProjete.vers(avec.classement);
  }
  if (premierRendu) { // déjà là à l'ouverture : pas de dépliage
    pli.style.transition = 'none';
    requestAnimationFrame(() => requestAnimationFrame(() => { pli.style.transition = ''; }));
  }
  pli.classList.remove('ferme');
}

function majInfo() {
  const j = etat.joueur, prochain = etat.proj[1];
  const pub = dateFr(M.premierMardi(M.moisSuivant(j.mois)));
  const lignes = [prochain.expires.length
    ? `Au calcul ${deMois(prochain.mois)} (publié le ${pub}) : ${prochain.expires.map(r => `${r.points} pts du ${dateFr(r.date)}`).join(', ')} sort${pluriel(prochain.expires.length, '', 'ent')}, perte nette ${prochain.perteNette} pt${pluriel(prochain.perteNette, '', 's')}`
    : `Rien n'expire au calcul ${deMois(prochain.mois)}, publié le ${pub}`];
  const cutP25 = j.classement > 30000 ? M.pointsPourClassement(30000, etat.table) : null;
  if (cutP25) lignes.push(`Il te manque ${nb(Math.max(0, cutP25 - j.points))} pts pour passer sous les 30 000 (fin des P25)`);
  $('#info').innerHTML = lignes.map(t => `<p>${echap(t)}</p>`).join('');
}

// ---------- La courbe des 12 prochains mois ----------
const G = { H: 176, haut: 34, bas: 36, cote: 22 };
const courbe = { avec: null, sans: null, geo: null };
const zone = $('#courbe');

// Courbe lisse qui ne dépasse jamais ses points (interpolation monotone).
function cheminLisse(pts) {
  const n = pts.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    d += `C${r1(pts[i][0] + dx[i] / 3)},${r1(pts[i][1] + t[i] * dx[i] / 3)},${r1(pts[i + 1][0] - dx[i] / 3)},${r1(pts[i + 1][1] - t[i + 1] * dx[i] / 3)},${r1(pts[i + 1][0])},${r1(pts[i + 1][1])}`;
  }
  return d;
}

function tracerCourbe() {
  const W = zone.clientWidth;
  if (!W || !courbe.avec) return;
  const n = courbe.avec.length, max = Math.max(1, ...courbe.avec, ...courbe.sans);
  const pas = (W - 2 * G.cote) / (n - 1), sol = G.H - G.bas, h = sol - G.haut;
  const X = (i) => G.cote + i * pas, Y = (v) => sol - (v / max) * h;
  const pts = courbe.avec.map((v, i) => [X(i), Y(v)]);
  const ligne = cheminLisse(pts);
  const svg = $('#courbe-svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${G.H}`);
  svg.innerHTML = `
    <defs><linearGradient id="fondu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent-trait);stop-opacity:.34"/><stop offset="1" style="stop-color:var(--accent-trait);stop-opacity:0"/></linearGradient></defs>
    <line class="sol" x1="${G.cote}" x2="${W - G.cote}" y1="${sol}" y2="${sol}"/>
    <path class="aire" d="${ligne}L${r1(X(n - 1))},${sol}L${r1(X(0))},${sol}Z"/>
    ${etat.simulations.length ? `<path class="sans" d="${cheminLisse(courbe.sans.map((v, i) => [X(i), Y(v)]))}"/>` : ''}
    <path class="ligne" d="${ligne}"/>
    <text class="val" x="${r1(X(0) - 4)}" y="${r1(pts[0][1] - 10)}">${Math.round(courbe.avec[0])}</text>
    <text class="val" x="${r1(X(n - 1) + 4)}" y="${r1(pts[n - 1][1] - 10)}" text-anchor="end">${Math.round(courbe.avec[n - 1])}</text>
    ${etat.proj.map((l, i) => l.expires.length ? `<circle class="expire" cx="${r1(X(i))}" cy="${sol + 8}" r="2.5"/>` : '').join('')}
    ${etat.proj.map((l, i) => `<text class="m" data-i="${i}" x="${r1(X(i))}" y="${G.H - 9}" text-anchor="middle">${MOIS_AXE[Number(l.mois.slice(5)) - 1]}</text>`).join('')}
    <g id="cur"><line id="cur-l" y1="20" y2="${sol}"/><circle id="cur-p" r="6.5"/><text id="cur-t" y="14" text-anchor="middle"></text></g>`;
  courbe.geo = { pts, W, pas };
  poserCurseur();
}

// Quand les points changent (tournoi ajouté ou enlevé), la courbe glisse de l'ancienne forme à la nouvelle.
const rMorph = creerRessort({ precision: 0.002, reponse: 0.55 });
let morph = null;
const pMorph = animer(rMorph, (t) => {
  if (!morph) return;
  const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * t);
  courbe.avec = mix(morph.deA, morph.versA); courbe.sans = mix(morph.deS, morph.versS);
  tracerCourbe();
}, MVT);

function majCourbe() {
  const versA = etat.proj.map(l => l.total), versS = etat.sans.map(l => l.total);
  if (!courbe.avec) { courbe.avec = versA; courbe.sans = versS; tracerCourbe(); }
  else { morph = { deA: courbe.avec.slice(), deS: courbe.sans.slice(), versA, versS }; pMorph.poser(0); pMorph.vers(1); }
  $('#courbe-sous').textContent = etat.simulations.length ? 'avec tes ajouts, sans eux en pointillé' : 'si tu ne rejoues pas';
  $('#legende').hidden = !etat.proj.some(l => l.expires.length);
}

// Le curseur : deux ressorts indépendants (x et y) vers le point du mois le plus proche du doigt.
const rcx = creerRessort({ reponse: 0.16, precision: 0.3 }), rcy = creerRessort({ reponse: 0.16, precision: 0.3 });
const pcx = animer(rcx, poserCurseur, MVT), pcy = animer(rcy, poserCurseur, MVT);

function poserCurseur() {
  const g = courbe.geo, trait = $('#cur-l');
  if (!g || !trait || etat.survol === null) return;
  const x = r1(rcx.valeur), l = etat.proj[etat.survol];
  trait.setAttribute('x1', x); trait.setAttribute('x2', x);
  $('#cur-p').setAttribute('cx', x); $('#cur-p').setAttribute('cy', r1(rcy.valeur));
  const txt = $('#cur-t');
  txt.setAttribute('x', borner(x, 36, g.W - 36)); txt.textContent = `${nb(l.total)} pts`;
  zone.querySelectorAll('text.m').forEach(el => el.classList.toggle('sel', Number(el.dataset.i) === etat.survol));
}

function scruter(i) {
  const g = courbe.geo;
  if (!g || i === etat.survol) return;
  const premier = etat.survol === null;
  etat.survol = i;
  zone.classList.add('scrute');
  zone.setAttribute('aria-valuenow', i);
  zone.setAttribute('aria-valuetext', `${M.libelleMois(etat.proj[i].mois)} : ${etat.proj[i].total} points, ${rangTxt(etat.proj[i].classement)}`);
  const [x, y] = g.pts[i];
  if (premier) { pcx.poser(x); pcy.poser(y); } else { pcx.vers(x); pcy.vers(y); }
  majHero();
}

function relacher() {
  if (etat.survol === null) return;
  etat.survol = null;
  zone.classList.remove('scrute');
  pcx.arreter(); pcy.arreter();
  zone.querySelectorAll('text.m.sel').forEach(el => el.classList.remove('sel'));
  majHero();
}

const indexSousLeDoigt = (e) => {
  const g = courbe.geo, cadre = zone.getBoundingClientRect();
  return borner(Math.round((e.clientX - cadre.left - G.cote) / g.pas), 0, g.pts.length - 1);
};
zone.addEventListener('pointerdown', (e) => {
  if (!courbe.geo) return;
  if (e.pointerType !== 'mouse') capturer(zone, e.pointerId);
  scruter(indexSousLeDoigt(e));
});
zone.addEventListener('pointermove', (e) => {
  if (courbe.geo && (e.pointerType === 'mouse' || zone.hasPointerCapture(e.pointerId))) scruter(indexSousLeDoigt(e));
});
['pointerup', 'pointercancel'].forEach(type => zone.addEventListener(type, (e) => { if (e.pointerType !== 'mouse') relacher(); }));
zone.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') relacher(); });
zone.addEventListener('blur', relacher);
zone.addEventListener('keydown', (e) => {
  const i = etat.survol ?? 0, dernier = etat.proj.length - 1;
  const vers = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: dernier }[e.key];
  if (e.key === 'Escape') relacher();
  else if (vers !== undefined) { e.preventDefault(); scruter(borner(etat.survol === null ? 0 : vers, 0, dernier)); }
});
new ResizeObserver(() => tracerCourbe()).observe(zone);

// ---------- Le palmarès ----------

function lignesPalmares() {
  const j = etat.joueur;
  const { retenus } = M.totalMois(j.resultats, j.mois);
  const reels = j.resultats.map(r => ({
    cle: `r|${r.date}|${r.categorie}|${r.rang}|${r.points}`, date: r.date, ajout: false, hors: !retenus.includes(r),
    cat: r.categorie, titre: titreEpreuve(r), points: r.points,
    sous: `${dateCourte(r.date)} · ${ordinal(r.rang)} · jusqu'en ${moisCourt(r.valableJusqua || M.dernierMoisValide(r.date))}${retenus.includes(r) ? '' : ' · hors des 12'}`,
  }));
  const simus = etat.simulations.map(s => ({
    cle: `s|${s.id}`, id: s.id, date: s.date, ajout: true, hors: false,
    cat: s.categorie, titre: 'Tournoi ajouté', points: s.points,
    sous: `${dateCourte(s.date)} · ${s.tour && M.LIBELLES_TOURS[s.tour] ? M.LIBELLES_TOURS[s.tour].toLowerCase() : ordinal(s.rang)} · ${s.paires} paires · dès ${moisCourt(M.moisEntree(s.date))}`,
  }));
  return [...reels, ...simus].sort((x, y) => x.date < y.date ? 1 : x.date > y.date ? -1 : 0);
}

function creerLigne(l) {
  const li = document.createElement('li');
  li.dataset.cle = l.cle;
  li.className = `${l.ajout ? 'ajout' : ''}${l.hors ? ' hors' : ''}`.trim();
  li.innerHTML = `<div class="dedans">${l.ajout ? '<div class="fond-suppr" aria-hidden="true">Enlever</div>' : ''}
    <div class="rangee"><div class="cat">${echap(l.cat)}</div>
      <div class="milieu"><div class="titre">${echap(l.titre)}</div><div class="sous">${echap(l.sous)}</div></div>
      <div class="pts">${l.points}<small>pts</small></div>
      ${l.ajout ? `<button class="croix" data-suppr="${echap(l.id)}" aria-label="Enlever ce tournoi">✕</button>` : ''}
    </div></div>`;
  if (l.ajout) brancherGlisse(li, l.id);
  return li;
}

function majListe() {
  const ul = $('#liste'), voulu = lignesPalmares();
  const presents = new Map([...ul.children].filter(li => !li.classList.contains('sort')).map(li => [li.dataset.cle, li]));
  let repere = ul.firstElementChild;
  for (const l of voulu) {
    while (repere && repere.classList.contains('sort')) repere = repere.nextElementSibling;
    let li = presents.get(l.cle);
    if (li) presents.delete(l.cle);
    else {
      li = creerLigne(l);
      if (!premierRendu) {
        li.classList.add('entre');
        requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entre')));
      }
    }
    if (li === repere) repere = repere.nextElementSibling; else ul.insertBefore(li, repere);
  }
  for (const li of presents.values()) {
    li.classList.add('sort');
    setTimeout(() => li.remove(), calme() ? 0 : 460);
  }
  premierRendu = false;
  const n = etat.simulations.length;
  $('#pal-compte').textContent = `${etat.joueur.resultats.length} résultats${n ? ` + ${n} ajouté${pluriel(n, '', 's')}` : ''}`;
}

function enlever(id) {
  etat.simulations = etat.simulations.filter(s => s.id !== id);
  sauverSimulations(); toutMettreAJour(); toast('Tournoi enlevé');
}

// Glisser une ligne ajoutée vers la gauche pour l'enlever : elle suit le doigt, et c'est l'élan qui décide.
function brancherGlisse(li, id) {
  const rangee = li.querySelector('.rangee');
  const r = creerRessort({ precision: 0.5 });
  const poser = (x) => { rangee.style.transform = `translate3d(${r1(x)}px,0,0)`; };
  const p = animer(r, poser, MVT);
  let g = null;
  rangee.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('button')) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: r.valeur, actif: false, suivi: creerSuiviVitesse() };
  });
  rangee.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.actif) {
      const dx = e.clientX - g.x0;
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - g.y0)) return;
      // le mouvement qui franchit le seuil est déjà suivi (un geste très rapide n'a parfois qu'un seul mouvement),
      // et le seuil est retranché pour que la ligne ne saute pas
      g.actif = true; p.arreter(); g.base = r.valeur; g.x0 += Math.sign(dx) * 10;
      capturer(rangee, e.pointerId);
    }
    let x = g.base + (e.clientX - g.x0);
    if (x > 0) x = elastique(x, rangee.offsetWidth);
    r.valeur = r.cible = x; r.vitesse = 0; poser(x);
    g.suivi.ajouter(x, e.timeStamp);
  });
  const fin = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const { actif, suivi } = g; g = null;
    if (!actif) return;
    const v = suivi.vitesse(), largeur = rangee.offsetWidth;
    // l'élan compte, mais il faut avoir vraiment tiré la ligne : un petit coup sec ne supprime rien
    if (r.valeur < -48 && r.valeur + projeter(v, 0.994) < -largeur * 0.45) p.vers(-largeur - 24, { vitesse: v, amortissement: 1, reponse: 0.3, apres: () => enlever(id) });
    else p.vers(0, { vitesse: v, amortissement: 0.82, reponse: 0.34 });
  };
  rangee.addEventListener('pointerup', fin);
  rangee.addEventListener('pointercancel', fin);
}

$('#liste').addEventListener('click', (e) => {
  const b = e.target.closest('[data-suppr]');
  if (b) enlever(b.dataset.suppr);
});

// ---------- Le formulaire d'ajout ----------
function samediProchain() {
  const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mêmes règles et mêmes messages que la première version de l'appli.
function lireAjout() {
  const a = etat.ajout;
  const s = {
    date: a.date, categorie: a.categorie, paires: a.paires,
    rang: a.tour ? M.rangDepuisTour(a.tour, a.paires) : a.rang,
    tour: a.tour,
  };
  if (!s.date) throw new Error('Il manque la date');
  const fin = M.finFenetre(etat.joueur.mois);
  if (s.date <= fin) throw new Error(`Un tournoi du ${dateFr(s.date)} serait déjà dans le classement ${deMois(etat.joueur.mois)} : choisis une date après le ${dateFr(fin)}`);
  // Le barème chargé est celui du guide 2027 : refuser plutôt que calculer faux sur une date antérieure.
  if (s.date < etat.bareme.enVigueurDepuis) throw new Error(`Le barème chargé s'applique aux tournois joués à partir du ${dateFr(etat.bareme.enVigueurDepuis)}`);
  if (!(s.rang >= 1)) throw new Error('Il manque le rang');
  s.points = M.points(etat.bareme, s.categorie, s.paires, s.rang);
  s.epreuve = `Tournoi ajouté ${s.categorie} à ${s.paires} paires`;
  return s;
}

$('#f-cat').innerHTML = M.CATEGORIES.map(c => `<button type="button" data-cat="${c}">${c}</button>`).join('');
$('#f-tours').innerHTML = Object.entries(M.LIBELLES_TOURS).map(([k, l]) => `<button type="button" data-tour="${k}">${echap(l)}</button>`).join('');

function majFormulaire() {
  const a = etat.ajout, interdites = M.categoriesInterdites(etat.joueur.classement);
  $('#f-cat').querySelectorAll('button').forEach(b => {
    b.classList.toggle('actif', b.dataset.cat === a.categorie);
    b.classList.toggle('interdit', interdites.includes(b.dataset.cat));
    b.setAttribute('aria-pressed', b.dataset.cat === a.categorie);
  });
  $('#f-tours').querySelectorAll('button').forEach(b => {
    b.classList.toggle('actif', b.dataset.tour === a.tour);
    b.setAttribute('aria-pressed', b.dataset.tour === a.tour);
  });
  $('#f-paires').textContent = a.paires;
  $('#f-rang').textContent = a.rang;
  if ($('#f-date').value !== a.date) $('#f-date').value = a.date;
  majApercu();
}

// Aperçu vivant : les points du tournoi, ce qu'il rapporte vraiment, et le rang estimé au mois où il compte.
function majApercu() {
  const boite = $('#f-apercu'), bouton = $('#f-ajouter'), j = etat.joueur;
  try {
    const s = lireAjout();
    const avec = M.projection(j.resultats, [...etat.simulations, { ...s, id: 'apercu' }], j.mois, etat.table, 12);
    const k = avec.findIndex(l => l.retenus.some(r => r.id === 'apercu'));
    const selonPaires = M.dependDesPaires(etat.bareme, s.categorie);
    const quand = M.libelleMois(M.moisEntree(s.date));
    let net = '', suite = `n'entrerait pas dans tes 12 meilleurs résultats (compterait dès ${quand})`;
    if (k >= 0) {
      const gain = avec[k].total - etat.proj[k].total;
      const places = avec[k].classement != null && etat.proj[k].classement != null ? etat.proj[k].classement - avec[k].classement : null;
      net = `<span class="net">${signe(gain)} net${pluriel(Math.abs(gain), '', 's')}</span>`;
      suite = `environ ${rangTxt(avec[k].classement)} au classement ${deMois(avec[k].mois)}${places ? ` (${signe(places)} place${pluriel(Math.abs(places), '', 's')})` : ''}`;
    }
    boite.innerHTML = `<div class="apercu"><span class="gros">${s.points}<small>pts</small></span>${net}
      <span class="txt">${ordinal(s.rang)} en ${s.categorie}${selonPaires ? ` à ${s.paires} paires` : ''} · ${echap(suite)}</span></div>
      ${selonPaires ? '' : `<div class="apercu"><span class="txt" style="margin:0">Barème unique depuis le ${dateFr(etat.bareme.enVigueurDepuis)} : en ${s.categorie}, le nombre de paires ne change plus les points, il sert seulement à situer le rang du tour</span></div>`}
      ${M.categoriesInterdites(j.classement).includes(s.categorie) ? `<div class="alerte">Un ${s.categorie} est interdit à ton classement actuel</div>` : ''}`;
    bouton.disabled = false;
  } catch (err) {
    boite.innerHTML = `<div class="alerte">${echap(err.message)}</div>`;
    bouton.disabled = true;
  }
}

$('#f-cat').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  etat.ajout.categorie = b.dataset.cat; majFormulaire();
});
$('#f-tours').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  etat.ajout.tour = b.dataset.tour; etat.ajout.rang = M.rangDepuisTour(b.dataset.tour, etat.ajout.paires); majFormulaire();
});
$('#f-date').addEventListener('input', (e) => { etat.ajout.date = e.target.value; majApercu(); });

function changerPas(champ, d) {
  const a = etat.ajout;
  if (champ === 'paires') { a.paires = borner(a.paires + d, 4, 64); if (a.tour) a.rang = M.rangDepuisTour(a.tour, a.paires); }
  else { a.rang = borner(a.rang + d, 1, 64); a.tour = null; }
  majFormulaire();
}
// − et + répondent dès l'appui, et se répètent si on garde le doigt dessus.
document.querySelectorAll('.pas').forEach((bloc) => {
  let minuterie = null;
  const stop = () => { clearTimeout(minuterie); clearInterval(minuterie); minuterie = null; };
  bloc.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button'); if (!b || e.button) return;
    const d = Number(b.dataset.pas);
    stop(); changerPas(bloc.dataset.champ, d);
    minuterie = setTimeout(() => { minuterie = setInterval(() => changerPas(bloc.dataset.champ, d), 70); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => bloc.addEventListener(type, stop));
  bloc.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail === 0) changerPas(bloc.dataset.champ, Number(b.dataset.pas)); });
});

$('#f-ajouter').addEventListener('click', () => {
  try {
    const s = lireAjout(), id = `s${Date.now()}`;
    etat.simulations.push({ id, creePourMois: etat.joueur.mois, ...s });
    sauverSimulations();
    fermerFeuille();
    toutMettreAJour();
    toast(`Ajouté : ${s.points} pts, compte dès ${M.libelleMois(M.moisEntree(s.date))}`);
    const li = [...$('#liste').children].find(el => el.dataset.cle === `s|${id}`);
    if (li) setTimeout(() => li.scrollIntoView({ block: 'center', behavior: calme() ? 'auto' : 'smooth' }), 260);
  } catch (err) { toast(err.message); }
});

// ---------- La feuille : se tire, résiste en butée, se lance pour fermer, se rattrape en plein vol ----------
const feuille = $('#feuille'), voile = $('#voile'), corps = $('#f-corps');
const rf = creerRessort({ precision: 0.5 });
let hauteur = 0, ouverte = false;
function poserFeuille(y) {
  feuille.style.transform = `translate3d(0,${r1(y)}px,0)`;
  voile.style.opacity = hauteur ? borner(1 - y / hauteur, 0, 1) : 0;
}
const pf = animer(rf, poserFeuille, MVT);

function ouvrirFeuille() {
  majFormulaire();
  feuille.inert = false; feuille.classList.add('la');
  hauteur = feuille.offsetHeight;
  corps.style.touchAction = corps.scrollHeight > corps.clientHeight + 1 ? 'pan-y' : 'none';
  if (!ouverte && !pf.enCours) pf.poser(hauteur);
  ouverte = true;
  voile.style.pointerEvents = 'auto';
  document.documentElement.classList.add('fige');
  pf.vers(0, { amortissement: 1, reponse: 0.4 });
  feuille.focus({ preventScroll: true });
}

function fermerFeuille(vitesse = 0) {
  if (!ouverte && !pf.enCours) return;
  ouverte = false;
  voile.style.pointerEvents = 'none';
  pf.vers(hauteur + 30, {
    vitesse, amortissement: 1, reponse: 0.34,
    apres: () => { feuille.classList.remove('la'); feuille.inert = true; document.documentElement.classList.remove('fige'); },
  });
}

let geste = null;
feuille.addEventListener('pointerdown', (e) => {
  if (e.button || e.target.closest('button,input,output')) return;
  if (corps.contains(e.target) && corps.scrollHeight > corps.clientHeight + 1) return; // contenu plus haut que l'écran : il défile
  geste = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: rf.valeur, actif: false, suivi: creerSuiviVitesse() };
  if (pf.enCours) { // rattrapée en plein mouvement : elle s'arrête sous le doigt, sans attendre
    pf.arreter(); geste.actif = true;
    capturer(feuille, e.pointerId);
    geste.suivi.ajouter(rf.valeur, e.timeStamp);
  }
});
feuille.addEventListener('pointermove', (e) => {
  if (!geste || e.pointerId !== geste.id) return;
  if (!geste.actif) {
    const dy = e.clientY - geste.y0;
    if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(e.clientX - geste.x0)) return;
    geste.actif = true; geste.base = rf.valeur; geste.y0 += Math.sign(dy) * 8; // même règle que pour les lignes
    capturer(feuille, e.pointerId);
  }
  let y = geste.base + (e.clientY - geste.y0);
  if (y < 0) y = -elastique(-y, hauteur);
  rf.valeur = rf.cible = y; rf.vitesse = 0; poserFeuille(y);
  geste.suivi.ajouter(y, e.timeStamp);
});
const finGeste = (e) => {
  if (!geste || e.pointerId !== geste.id) return;
  const { actif, suivi } = geste; geste = null;
  if (!actif) return;
  const v = suivi.vitesse();
  if (rf.valeur + projeter(v) > hauteur * 0.5) fermerFeuille(v);
  else { ouverte = true; voile.style.pointerEvents = 'auto'; pf.vers(0, { vitesse: v, amortissement: 0.82, reponse: 0.32 }); }
};
feuille.addEventListener('pointerup', finGeste);
feuille.addEventListener('pointercancel', finGeste);

$('#plus').addEventListener('click', ouvrirFeuille);
$('#f-fermer').addEventListener('click', () => fermerFeuille());
voile.addEventListener('click', () => fermerFeuille());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ouverte) { fermerFeuille(); $('#plus').focus({ preventScroll: true }); } });

// ---------- Pied, barre du haut ----------
$('#tout-effacer').addEventListener('click', () => {
  if (confirm('Enlever tous les tournois ajoutés ?')) { etat.simulations = []; sauverSimulations(); toutMettreAJour(); }
});
$('#copier-lien').addEventListener('click', async () => {
  const lien = `${location.origin}${location.pathname}#simu=${btoa(unescape(encodeURIComponent(JSON.stringify(etat.simulations))))}`;
  try { await navigator.clipboard.writeText(lien); toast('Lien copié, ouvre-le sur ton autre appareil'); } catch { prompt('Copie ce lien :', lien); }
});

// La petite barre du haut apparaît à mesure que le grand rang sort de l'écran.
function majHaut() {
  const h = $('#haut');
  h.style.opacity = borner((h.offsetHeight - $('#h-rang').getBoundingClientRect().bottom + 14) / 26, 0, 1);
}
addEventListener('scroll', majHaut, { passive: true });

charger().catch(err => { $('#h-mois').textContent = `Erreur de chargement : ${err.message}`; });
