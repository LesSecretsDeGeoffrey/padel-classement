import * as M from './moteur.js';

const $ = (s, r = document) => r.querySelector(s);
const CLE_SIMU = 'padel.simulations';
const CLE_MOIS = 'padel.dernierMoisVu';
const ABREV_MOIS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
const etat = { bareme: null, joueur: null, table: null, simulations: [], ecran: 'aujourdhui', etsi: null };

const nb = (n) => n == null ? '–' : new Intl.NumberFormat('fr-FR').format(n);
const rangTxt = (c) => c == null ? 'non classé' : `${nb(c)}e`;
const dateFr = (d) => d.split('-').reverse().join('/');
const signe = (n) => n > 0 ? `+${nb(n)}` : nb(n);
const echap = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// « de septembre 2026 » mais « d'octobre 2026 », « d'avril », « d'août »
const deMois = (mois) => { const l = M.libelleMois(mois); return /^[aeiouy]/.test(l) ? `d'${l}` : `de ${l}`; };
const abrevMois = (mois) => ABREV_MOIS[Number(mois.slice(5)) - 1];
const rangCourt = (c) => c == null ? '' : c >= 10000 ? `${(c / 1000).toFixed(1).replace('.', ',')}k` : String(c);

function lireLocal(cle, defaut) { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; } }
function ecrireLocal(cle, valeur) { try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible */ } }

let toastTimer;
export function toast(msg) {
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

  // Nouveau mois de classement : les simulations couvertes par la fenêtre sont remplacées par les vrais résultats.
  const dernierVu = lireLocal(CLE_MOIS, null);
  if (dernierVu && joueur.mois > dernierVu) {
    const { gardees, supprimees } = M.purgerSimulations(etat.simulations, joueur.mois);
    if (supprimees.length) {
      etat.simulations = gardees; ecrireLocal(CLE_SIMU, gardees);
      toast(`Nouveau classement ${deMois(joueur.mois)} chargé : ${supprimees.length} simulation${supprimees.length > 1 ? 's' : ''} remplacée${supprimees.length > 1 ? 's' : ''} par tes vrais résultats`);
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
    if (Array.isArray(simus) && confirm(`Remplacer tes ${etat.simulations.length} simulation(s) par les ${simus.length} du lien ?`)) {
      etat.simulations = simus; ecrireLocal(CLE_SIMU, simus); toast('Simulations importées');
    }
  } catch { toast('Lien de sauvegarde illisible'); }
  history.replaceState(null, '', location.pathname);
}

export function sauverSimulations() { ecrireLocal(CLE_SIMU, etat.simulations); }

function rendre() {
  if (!etat.joueur) return;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('actif', b.dataset.ecran === etat.ecran));
  document.querySelectorAll('.ecran').forEach(e => e.classList.toggle('actif', e.id === `ecran-${etat.ecran}`));
  ({ aujourdhui: rendreAujourdhui, projection: rendreProjection, etsi: rendreEtSi, tournois: rendreTournois })[etat.ecran]();
}

document.querySelector('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  etat.ecran = b.dataset.ecran; rendre(); window.scrollTo(0, 0);
});

// ---------- Écran Aujourd'hui ----------
function rendreAujourdhui() {
  const j = etat.joueur;
  const proj = M.projection(j.resultats, etat.simulations, j.mois, etat.table, 2);
  const auj = proj[0], prochain = proj[1];
  const { retenus, nonRetenus } = M.totalMois(j.resultats, j.mois);
  const prochainePub = dateFr(M.premierMardi(M.moisSuivant(j.mois)));
  const ligneRes = (r, faible) => `<tr class="${faible ? 'faible' : ''}"><td>${dateFr(r.date)}</td><td>${echap(r.categorie)} <span class="puce">${echap(r.rang)}e</span><div class="sous">${echap(r.epreuve || '')}</div></td><td class="num">${r.points}</td><td class="num">${M.libelleMois(r.valableJusqua || M.dernierMoisValide(r.date))}</td></tr>`;
  const bandeau = prochain.expires.length
    ? `<div class="bandeau">Au calcul ${deMois(prochain.mois)} (publié le ${prochainePub}) : ${prochain.expires.map(r => `${r.points} pts (${dateFr(r.date)})`).join(', ')} sort${prochain.expires.length > 1 ? 'ent' : ''}, perte nette ${prochain.perteNette} pt${prochain.perteNette > 1 ? 's' : ''} → ${nb(prochain.total)} pts, ${rangTxt(prochain.classement)}</div>`
    : `<div class="bandeau">Rien n'expire au calcul ${deMois(prochain.mois)} (publié le ${prochainePub})</div>`;
  $('#ecran-aujourdhui').innerHTML = `
    <div class="carte">
      <span class="overline">${M.libelleMois(j.mois)}</span>
      <div class="rang" style="margin-top:10px">${rangTxt(j.classement)}</div>
      <div class="pts">${nb(j.points)} points · ${nb(j.positionnement.france[1])} joueurs classés</div>
      <span class="evo ${j.evolution < 0 ? 'neg' : ''}">${signe(j.evolution)} places ce mois-ci</span>
      ${bandeau}
      ${etat.simulations.length ? `<div class="sous" style="margin-top:8px">Avec tes ${etat.simulations.length} simulation${etat.simulations.length > 1 ? 's' : ''} : ${nb(prochain.total)} pts en ${M.libelleMois(prochain.mois)}, ${rangTxt(prochain.classement)}</div>` : ''}
    </div>
    <h2>Tes 12 résultats retenus</h2>
    <div class="carte" style="padding:6px 10px"><table><thead><tr><th>Date</th><th>Épreuve</th><th class="num">Pts</th><th class="num">Jusqu'à</th></tr></thead>
      <tbody>${retenus.map(r => ligneRes(r, false)).join('')}${nonRetenus.map(r => ligneRes(r, true)).join('')}</tbody></table>
      ${nonRetenus.length ? `<div class="vide">Les ${nonRetenus.length} derniers ne comptent pas (au-delà des 12)</div>` : ''}
    </div>
    <h2>Historique</h2>
    <div class="carte">${j.historique.map(h => `<div class="ligne"><span>${M.libelleMois(h.mois)}</span><span class="num">${rangTxt(h.classement)} <span class="puce">${signe(h.evolution)}</span></span></div>`).join('')}</div>`;
}

// ---------- Écran Projection ----------
function rendreProjection() {
  const j = etat.joueur;
  const p = M.projection(j.resultats, etat.simulations, j.mois, etat.table, 12);
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
  const detail = p.map(l => `<div class="ligne"><span>${M.libelleMois(l.mois)}${l.expires.length ? ` <span class="puce">−${l.perteNette} pt${l.perteNette > 1 ? 's' : ''}</span>` : ''}${l.entrants.length ? ` <span class="puce simu">+${l.entrants.length}</span>` : ''}</span><span class="num">${nb(l.total)} pts · ${rangTxt(l.classement)}</span></div>`).join('');
  $('#ecran-projection').innerHTML = `
    <div class="carte">
      <span class="overline">12 prochains classements</span>
      <svg class="graphe" viewBox="0 0 ${W} ${H}" role="img" aria-label="Points par mois">${barres}</svg>
      <div class="sous">Barre or = points retenus · haut foncé = part des simulations · point rouge = un résultat expire · rang estimé avec la table ${deMois(j.mois)}</div>
    </div>
    <div class="carte">${detail}</div>
    ${etat.simulations.length ? '' : '<div class="vide">Ajoute des simulations dans « Et si » pour voir leur effet ici</div>'}`;
}

// ---------- Simulations : formulaire partagé ----------
function samediProchain() {
  const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formulaireSimu(prefixe, valeurs) {
  const v = Object.assign({ date: samediProchain(), categorie: 'P100', paires: 16, tour: 'quart', rang: 8 }, valeurs || {});
  return `
    <label>Date du tournoi</label><input type="date" id="${prefixe}-date" value="${v.date}">
    <label>Catégorie</label><select id="${prefixe}-cat">${M.CATEGORIES.map(c => `<option ${c === v.categorie ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <label>Paires inscrites</label><input type="number" id="${prefixe}-paires" min="4" max="64" value="${v.paires}">
    <label>Tour atteint</label>
    <div class="tours" id="${prefixe}-tours">${Object.entries(M.LIBELLES_TOURS).map(([k, l]) => `<button type="button" data-tour="${k}" class="${k === v.tour ? 'actif' : ''}">${l}</button>`).join('')}</div>
    <label>ou rang final exact</label><input type="number" id="${prefixe}-rang" min="1" max="64" value="${v.rang}">`;
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
  if (!(s.rang >= 1)) throw new Error('Il manque le rang');
  s.points = M.points(etat.bareme, s.categorie, s.paires, s.rang);
  s.epreuve = `Simulation ${s.categorie} à ${s.paires} paires`;
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

function ajouterSimulation(s) {
  etat.simulations.push({ id: `s${Date.now()}`, creePourMois: etat.joueur.mois, ...s });
  sauverSimulations();
}

function moisIndex(depuis, mois) {
  const [a1, m1] = depuis.split('-').map(Number), [a2, m2] = mois.split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

// ---------- Écran Et si ----------
function rendreEtSi() {
  $('#ecran-etsi').innerHTML = `
    <div class="carte">
      <span class="overline">Et si je joue…</span>
      ${formulaireSimu('etsi', etat.etsi)}
      <div class="resultat" id="etsi-resultat"></div>
      <button class="btn" id="etsi-ajouter">Ajouter à mes simulations</button>
    </div>`;
  brancherFormulaire('etsi', calculerEtSi);
  $('#etsi-ajouter').addEventListener('click', () => {
    try { ajouterSimulation(lireFormulaire('etsi')); toast('Simulation ajoutée'); etat.ecran = 'tournois'; rendre(); }
    catch (err) { toast(err.message); }
  });
  calculerEtSi();
}

function calculerEtSi() {
  const zone = $('#etsi-resultat');
  let s;
  try { s = lireFormulaire('etsi'); } catch (err) { zone.innerHTML = `<div class="bandeau alerte">${echap(err.message)}</div>`; return; }
  etat.etsi = { date: s.date, categorie: s.categorie, paires: s.paires, tour: s.tour, rang: s.rang };
  const j = etat.joueur, moisE = M.moisEntree(s.date);
  const n = Math.max(2, moisIndex(j.mois, moisE) + 1);
  const base = M.projection(j.resultats, etat.simulations, j.mois, etat.table, n);
  const avec = M.projection(j.resultats, [...etat.simulations, { ...s, id: 'candidat' }], j.mois, etat.table, n);
  const lb = base[base.length - 1], la = avec[avec.length - 1];
  const remplace = lb.retenus.find(r => !la.retenus.some(x => x.date === r.date && x.points === r.points && x.simule === r.simule && x.id === r.id));
  const entre = la.retenus.some(r => r.id === 'candidat');
  const places = lb.classement && la.classement ? lb.classement - la.classement : null;
  const interdites = M.categoriesInterdites(j.classement);
  const cutP25 = j.classement > 30000 ? M.pointsPourClassement(30000, etat.table) : null;
  zone.innerHTML = `
    <div class="gros">${s.points} pts</div>
    <div class="sous">${s.categorie} à ${s.paires} paires, rang ${s.rang} · entre au classement ${deMois(moisE)}</div>
    <div class="ligne"><span>Sans ce résultat</span><span class="num">${nb(lb.total)} pts · ${rangTxt(lb.classement)}</span></div>
    <div class="ligne"><span>Avec ce résultat</span><span class="num"><b>${nb(la.total)} pts · ${rangTxt(la.classement)}</b></span></div>
    <div class="ligne"><span>Places gagnées</span><span class="num">${places == null ? '–' : signe(places)}</span></div>
    <div class="sous" style="margin-top:8px">${entre ? (remplace ? `Il prend la place de ton résultat à ${remplace.points} pts (${dateFr(remplace.date)})` : 'Il entre dans tes 12 sans en sortir aucun') : 'Il n\'entre pas dans tes 12 résultats retenus'}</div>
    ${interdites.includes(s.categorie) ? `<div class="bandeau alerte">Un ${s.categorie} est interdit à ton classement actuel (${rangTxt(j.classement)})</div>` : ''}
    ${cutP25 ? `<div class="bandeau">Il te manque ${nb(Math.max(0, cutP25 - lb.total))} pts pour passer sous les 30 000 (fin des P25)</div>` : ''}`;
}

// ---------- Écran Tournois ----------
function rendreTournois() {
  const j = etat.joueur;
  const reels = j.resultats.slice().sort((x, y) => x.date < y.date ? 1 : -1);
  const simus = etat.simulations.slice().sort((x, y) => x.date < y.date ? -1 : 1);
  $('#ecran-tournois').innerHTML = `
    <h2 style="margin-top:6px">Mes simulations</h2>
    <div class="carte" style="padding:6px 10px">
      ${simus.length ? `<table><thead><tr><th>Date</th><th>Tournoi</th><th class="num">Pts</th><th></th></tr></thead><tbody>
        ${simus.map(s => `<tr class="simu"><td>${dateFr(s.date)}</td><td>${echap(s.categorie)} · ${s.paires} paires · rang ${s.rang}<div class="sous">entre en ${M.libelleMois(M.moisEntree(s.date))}</div></td><td class="num">${s.points}</td><td class="num"><button class="btn-mini" data-suppr="${echap(s.id)}" aria-label="Supprimer">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="vide">Aucune simulation</div>'}
    </div>
    ${simus.length ? '<button class="btn danger" id="tout-effacer">Effacer toutes les simulations</button>' : ''}
    <button class="btn secondaire" id="copier-lien">Copier mon lien de sauvegarde</button>
    <h2>Ajouter une simulation</h2>
    <div class="carte">${formulaireSimu('ajout')}<button class="btn" id="ajout-valider">Ajouter</button></div>
    <h2>Résultats réels (${M.libelleMois(j.mois)})</h2>
    <div class="carte" style="padding:6px 10px"><table><thead><tr><th>Date</th><th>Épreuve</th><th class="num">Pts</th></tr></thead><tbody>
      ${reels.map(r => `<tr><td>${dateFr(r.date)}</td><td>${echap(r.categorie)} <span class="puce">${r.rang}e</span><div class="sous">${echap(r.epreuve || '')}</div></td><td class="num">${r.points}</td></tr>`).join('')}
    </tbody></table></div>`;
  brancherFormulaire('ajout', () => {});
  $('#ajout-valider').addEventListener('click', () => {
    try { ajouterSimulation(lireFormulaire('ajout')); toast('Simulation ajoutée'); rendre(); } catch (err) { toast(err.message); }
  });
  const te = $('#tout-effacer');
  if (te) te.addEventListener('click', () => { if (confirm('Effacer toutes les simulations ?')) { etat.simulations = []; sauverSimulations(); rendre(); } });
  $('#copier-lien').addEventListener('click', async () => {
    const lien = `${location.origin}${location.pathname}#simu=${btoa(unescape(encodeURIComponent(JSON.stringify(etat.simulations))))}`;
    try { await navigator.clipboard.writeText(lien); toast('Lien copié, ouvre-le sur ton autre appareil'); } catch { prompt('Copie ce lien :', lien); }
  });
}

// Suppression unitaire : un seul écouteur délégué, branché une fois (le rendu recrée le contenu).
$('#ecran-tournois').addEventListener('click', (e) => {
  const b = e.target.closest('[data-suppr]'); if (!b) return;
  etat.simulations = etat.simulations.filter(s => s.id !== b.dataset.suppr); sauverSimulations(); rendre();
});

export { etat, rendre, M, nb, rangTxt, dateFr, signe, echap };
charger().catch(err => { $('#sous-titre').textContent = `Erreur de chargement : ${err.message}`; });
