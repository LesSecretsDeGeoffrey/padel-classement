import * as M from './moteur.js';

const $ = (s, r = document) => r.querySelector(s);
const CLE_SIMU = 'padel.simulations';
const CLE_MOIS = 'padel.dernierMoisVu';
const ABREV_MOIS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
const etat = { bareme: null, joueur: null, table: null, simulations: [], ajout: null };

const nb = (n) => n == null ? '–' : new Intl.NumberFormat('fr-FR').format(n);
const rangTxt = (c) => c == null ? 'non classé' : `${nb(c)}e`;
const dateFr = (d) => d.split('-').reverse().join('/');
const signe = (n) => n > 0 ? `+${nb(n)}` : nb(n);
const echap = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// « de septembre 2026 » mais « d'octobre 2026 », « d'avril », « d'août »
const deMois = (mois) => { const l = M.libelleMois(mois); return /^[aeiouy]/.test(l) ? `d'${l}` : `de ${l}`; };
const abrevMois = (mois) => ABREV_MOIS[Number(mois.slice(5)) - 1];
const rangCourt = (c) => c == null ? '' : c >= 10000 ? `${(c / 1000).toFixed(1).replace('.', ',')}k` : String(c);
const pluriel = (n, un, plus) => n > 1 ? plus : un;

function lireLocal(cle, defaut) { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; } }
function ecrireLocal(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible */ } }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 4500);
}

async function chargerJson(chemin) {
  const r = await fetch(chemin, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`);
  return r.json();
}

async function charger() {
  const { mois } = await chargerJson('data/dernier.json');
  const [bareme, joueur, cl] = await Promise.all([
    chargerJson('data/bareme.json'), chargerJson(`data/joueur/${mois}.json`), chargerJson(`data/classement/${mois}.json`),
  ]);
  etat.bareme = bareme; etat.joueur = joueur; etat.table = cl.table;
  etat.simulations = lireLocal(CLE_SIMU, []);

  // Nouveau mois de classement : les tournois ajoutés couverts par la fenêtre sont remplacés par les vrais résultats.
  const dernierVu = lireLocal(CLE_MOIS, null);
  if (dernierVu && joueur.mois > dernierVu) {
    const { gardees, supprimees } = M.purgerSimulations(etat.simulations, joueur.mois);
    if (supprimees.length) {
      etat.simulations = gardees; ecrireLocal(CLE_SIMU, gardees);
      toast(`Nouveau classement ${deMois(joueur.mois)} chargé : ${supprimees.length} tournoi${pluriel(supprimees.length, '', 's')} ajouté${pluriel(supprimees.length, '', 's')} remplacé${pluriel(supprimees.length, '', 's')} par tes vrais résultats`);
    }
  }
  ecrireLocal(CLE_MOIS, joueur.mois);
  importerDepuisLien();
  $('#sous-titre').textContent = `Classement ${deMois(joueur.mois)} · relevé le ${dateFr(joueur.releveLe)}`;
  rendre();
}

function importerDepuisLien() {
  const m = location.hash.match(/#simu=([^&]+)/);
  if (!m) return;
  try {
    const simus = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (Array.isArray(simus) && confirm(`Remplacer tes ${etat.simulations.length} tournoi(s) ajouté(s) par les ${simus.length} du lien ?`)) {
      etat.simulations = simus; ecrireLocal(CLE_SIMU, simus); toast('Tournois importés');
    }
  } catch { toast('Lien de sauvegarde illisible'); }
  history.replaceState(null, '', location.pathname);
}

function sauverSimulations() { ecrireLocal(CLE_SIMU, etat.simulations); }

// ---------- Rendu : un seul écran ----------
function rendre() {
  if (!etat.joueur) return;
  const j = etat.joueur;
  const proj = M.projection(j.resultats, etat.simulations, j.mois, etat.table, 12);
  $('#app').innerHTML = carteClassement(j, proj) + carteAjout() + cartePalmares(j, proj) + carteProjection(j, proj) + pied();
  brancherFormulaire('ajout', apercuAjout);
  apercuAjout();
  $('#ajout-valider').addEventListener('click', () => {
    try {
      const s = lireFormulaire('ajout');
      etat.simulations.push({ id: `s${Date.now()}`, creePourMois: j.mois, ...s });
      sauverSimulations();
      etat.ajout = { ...etat.ajout, date: s.date };
      rendre();
      toast(`Ajouté au palmarès : ${s.points} pts, compte dès ${M.libelleMois(M.moisEntree(s.date))}`);
    } catch (err) { toast(err.message); }
  });
  const te = $('#tout-effacer');
  if (te) te.addEventListener('click', () => { if (confirm('Enlever tous les tournois ajoutés ?')) { etat.simulations = []; sauverSimulations(); rendre(); } });
  $('#copier-lien').addEventListener('click', async () => {
    const lien = `${location.origin}${location.pathname}#simu=${btoa(unescape(encodeURIComponent(JSON.stringify(etat.simulations))))}`;
    try { await navigator.clipboard.writeText(lien); toast('Lien copié, ouvre-le sur ton autre appareil'); } catch { prompt('Copie ce lien :', lien); }
  });
}

// Suppression unitaire : un seul écouteur délégué, branché une fois (le rendu recrée le contenu).
$('#app').addEventListener('click', (e) => {
  const b = e.target.closest('[data-suppr]'); if (!b) return;
  etat.simulations = etat.simulations.filter(s => s.id !== b.dataset.suppr); sauverSimulations(); rendre();
  toast('Tournoi enlevé');
});

function carteClassement(j, proj) {
  const prochain = proj[1];
  const prochainePub = dateFr(M.premierMardi(M.moisSuivant(j.mois)));
  const cutP25 = j.classement > 30000 ? M.pointsPourClassement(30000, etat.table) : null;
  let ligneSimu = '';
  if (etat.simulations.length) {
    // premier mois où un tournoi ajouté compte, comparé au même mois sans lui
    const sans = M.projection(j.resultats, [], j.mois, etat.table, 12);
    const i = proj.findIndex(l => l.retenus.some(r => r.simule));
    if (i >= 0) {
      const places = sans[i].classement && proj[i].classement ? sans[i].classement - proj[i].classement : null;
      ligneSimu = `<div class="bandeau simu">Avec tes ${etat.simulations.length} tournoi${pluriel(etat.simulations.length, '', 's')} ajouté${pluriel(etat.simulations.length, '', 's')} : <b>${nb(proj[i].total)} pts · ${rangTxt(proj[i].classement)}</b> au classement ${deMois(proj[i].mois)}${places ? ` (${signe(places)} places)` : ''}</div>`;
    } else {
      ligneSimu = `<div class="bandeau">Tes tournois ajoutés n'entrent pas dans tes 12 meilleurs résultats sur les 12 prochains mois</div>`;
    }
  }
  const expiration = prochain.expires.length
    ? `Au calcul ${deMois(prochain.mois)} (publié le ${prochainePub}) : ${prochain.expires.map(r => `${r.points} pts du ${dateFr(r.date)}`).join(', ')} sort${pluriel(prochain.expires.length, '', 'ent')}, perte nette ${prochain.perteNette} pt${pluriel(prochain.perteNette, '', 's')}`
    : `Rien n'expire au calcul ${deMois(prochain.mois)} (publié le ${prochainePub})`;
  return `
    <div class="carte">
      <span class="overline">${M.libelleMois(j.mois)}</span>
      <div class="rang" style="margin-top:10px">${rangTxt(j.classement)}</div>
      <div class="pts">${nb(j.points)} points · ${nb(j.positionnement.france[1])} joueurs classés · ligue ${rangTxt(j.positionnement.ligue[0])}</div>
      <span class="evo ${j.evolution < 0 ? 'neg' : ''}">${signe(j.evolution)} places ce mois-ci</span>
      ${ligneSimu}
      <div class="sous" style="margin-top:10px">${expiration}</div>
      ${cutP25 ? `<div class="sous">Il te manque ${nb(Math.max(0, cutP25 - j.points))} pts pour passer sous les 30 000 (fin des P25)</div>` : ''}
    </div>`;
}

function carteAjout() {
  return `
    <h2>Ajouter un tournoi</h2>
    <div class="carte">
      ${formulaireSimu('ajout', etat.ajout)}
      <div class="apercu" id="ajout-apercu"></div>
      <button class="btn" id="ajout-valider">Ajouter à mon palmarès</button>
    </div>`;
}

function cartePalmares(j, proj) {
  const { retenus } = M.totalMois(j.resultats, j.mois);
  const reels = j.resultats.map(r => ({ ...r, simule: false, retenu: retenus.includes(r) }));
  const simus = etat.simulations.map(s => ({ ...s, simule: true, moisE: M.moisEntree(s.date) }));
  const lignes = [...reels, ...simus].sort((x, y) => x.date < y.date ? 1 : x.date > y.date ? -1 : 0);
  const rows = lignes.map(r => r.simule
    ? `<tr class="simu"><td>${dateFr(r.date)}</td><td>${echap(r.categorie)} <span class="puce">${r.rang}e</span> <span class="puce simu">ajouté</span><div class="sous">${r.paires} paires · compte dès ${M.libelleMois(r.moisE)}</div></td><td class="num">${r.points}</td><td class="num"><button class="btn-mini" data-suppr="${echap(r.id)}" aria-label="Enlever">✕</button></td></tr>`
    : `<tr class="${r.retenu ? '' : 'faible'}"><td>${dateFr(r.date)}</td><td>${echap(r.categorie)} <span class="puce">${r.rang}e</span>${r.retenu ? '' : ' <span class="puce hors">hors des 12</span>'}<div class="sous">${echap(r.epreuve || '')} · jusqu'à ${M.libelleMois(r.valableJusqua || M.dernierMoisValide(r.date))}</div></td><td class="num">${r.points}</td><td></td></tr>`
  ).join('');
  return `
    <h2>Mon palmarès <small>${j.resultats.length} résultats${simus.length ? ` + ${simus.length} ajouté${pluriel(simus.length, '', 's')}` : ''}</small></h2>
    <div class="carte" style="padding:6px 10px">
      <table><thead><tr><th>Date</th><th>Tournoi</th><th class="num">Pts</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="vide">Les 12 meilleurs comptent ; les lignes grisées sont hors des 12 ce mois-ci</div>
    </div>`;
}

function carteProjection(j, p) {
  const max = Math.max(...p.map(l => l.total), 1);
  const W = 360, H = 170, base = 132, larg = 24, pas = 30, x0 = 6;
  const barres = p.map((l, i) => {
    const x = x0 + i * pas, h = Math.round(l.total / max * 100);
    const simuPts = l.retenus.filter(r => r.simule).reduce((s, r) => s + r.points, 0);
    const hs = Math.round(simuPts / max * 100);
    return `<rect class="barre" x="${x}" y="${base - h}" width="${larg}" height="${h}" rx="3"/>
      ${hs ? `<rect class="barre simu" x="${x}" y="${base - h}" width="${larg}" height="${hs}" rx="3"/>` : ''}
      <text x="${x + larg / 2}" y="${base - h - 4}" text-anchor="middle">${l.total}</text>
      <text class="rangtxt" x="${x + larg / 2}" y="${base + 12}" text-anchor="middle">${rangCourt(l.classement)}</text>
      <text x="${x + larg / 2}" y="${base + 24}" text-anchor="middle">${abrevMois(l.mois)}</text>
      ${l.expires.length ? `<circle class="expire" cx="${x + larg / 2}" cy="${base + 32}" r="2.5"/>` : ''}`;
  }).join('');
  const detail = p.map(l => `<div class="ligne"><span>${M.libelleMois(l.mois)}${l.expires.length ? ` <span class="puce">−${l.perteNette} pt${pluriel(l.perteNette, '', 's')}</span>` : ''}${l.entrants.length ? ` <span class="puce simu">+${l.entrants.length}</span>` : ''}</span><span class="num">${nb(l.total)} pts · ${rangTxt(l.classement)}</span></div>`).join('');
  return `
    <h2>Les 12 prochains mois</h2>
    <div class="carte">
      <svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Points par mois">${barres}</svg>
      <div class="sous">Barre or = points retenus · haut foncé = part des tournois ajoutés · point rouge = un résultat expire · rang estimé avec la table ${deMois(j.mois)}</div>
      <details style="margin-top:8px"><summary>Le détail mois par mois</summary>${detail}</details>
    </div>`;
}

function pied() {
  return `<div class="pied">
    <button class="lien" id="copier-lien">Copier mon lien de sauvegarde</button>
    ${etat.simulations.length ? '<button class="lien" id="tout-effacer">Enlever tous les tournois ajoutés</button>' : ''}
  </div>
  <div class="vide" style="text-align:center">Barème FFT du guide 2027, en vigueur depuis le ${dateFr(etat.bareme.enVigueurDepuis)}</div>`;
}

// ---------- Formulaire d'ajout ----------
function samediProchain() {
  const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formulaireSimu(prefixe, valeurs) {
  const v = Object.assign({ date: samediProchain(), categorie: 'P100', paires: 16, tour: 'quart', rang: 8 }, valeurs || {});
  return `
    <div class="grille2">
      <div><label>Date</label><input type="date" id="${prefixe}-date" value="${v.date}"></div>
      <div><label>Catégorie</label><select id="${prefixe}-cat">${M.CATEGORIES.map(c => `<option ${c === v.categorie ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div><label>Paires inscrites</label><input type="number" id="${prefixe}-paires" min="4" max="64" value="${v.paires}"></div>
      <div><label>Rang final</label><input type="number" id="${prefixe}-rang" min="1" max="64" value="${v.rang}"></div>
    </div>
    <label>Tour atteint</label>
    <div class="tours" id="${prefixe}-tours">${Object.entries(M.LIBELLES_TOURS).map(([k, l]) => `<button type="button" data-tour="${k}" class="${k === v.tour ? 'actif' : ''}">${l}</button>`).join('')}</div>`;
}

function lireFormulaire(prefixe) {
  const tourActif = $(`#${prefixe}-tours button.actif`);
  const rangSaisi = Number($(`#${prefixe}-rang`).value);
  const paires = Number($(`#${prefixe}-paires`).value);
  const s = {
    date: $(`#${prefixe}-date`).value, categorie: $(`#${prefixe}-cat`).value, paires,
    rang: tourActif ? M.rangDepuisTour(tourActif.dataset.tour, paires) : rangSaisi,
    tour: tourActif ? tourActif.dataset.tour : null,
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

function brancherFormulaire(prefixe, auChangement) {
  const tours = $(`#${prefixe}-tours`), rang = $(`#${prefixe}-rang`), paires = $(`#${prefixe}-paires`);
  const majRang = () => { const b = tours.querySelector('button.actif'); if (b) rang.value = M.rangDepuisTour(b.dataset.tour, Number(paires.value)); };
  tours.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    tours.querySelectorAll('button').forEach(x => x.classList.toggle('actif', x === b));
    majRang(); auChangement();
  });
  rang.addEventListener('input', () => { tours.querySelectorAll('button').forEach(x => x.classList.remove('actif')); auChangement(); });
  paires.addEventListener('input', () => { majRang(); auChangement(); });
  [`#${prefixe}-date`, `#${prefixe}-cat`].forEach(sel => $(sel).addEventListener('input', auChangement));
}

// Aperçu vivant sous le formulaire : les points du tournoi et le mois où il compte.
function apercuAjout() {
  const zone = $('#ajout-apercu'), btn = $('#ajout-valider');
  try {
    const s = lireFormulaire('ajout');
    etat.ajout = { date: s.date, categorie: s.categorie, paires: s.paires, tour: s.tour, rang: s.rang };
    const interdit = M.categoriesInterdites(etat.joueur.classement).includes(s.categorie);
    const selonPaires = M.dependDesPaires(etat.bareme, s.categorie);
    zone.innerHTML = `<b>${s.points} pts</b> · rang ${s.rang} en ${s.categorie}${selonPaires ? ` à ${s.paires} paires` : ''} · compte dès ${M.libelleMois(M.moisEntree(s.date))}
      ${selonPaires ? '' : `<div class="sous">Barème unique depuis le ${dateFr(etat.bareme.enVigueurDepuis)} : en ${s.categorie}, le nombre de paires ne change plus les points, il sert seulement à situer le rang du tour</div>`}
      ${interdit ? `<div class="bandeau alerte">Un ${s.categorie} est interdit à ton classement actuel</div>` : ''}`;
    btn.disabled = false;
  } catch (err) {
    zone.innerHTML = `<div class="bandeau alerte">${echap(err.message)}</div>`;
    btn.disabled = true;
  }
}

charger().catch(err => { $('#sous-titre').textContent = `Erreur de chargement : ${err.message}`; });
