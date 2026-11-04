// Relevé des vues TrendSaaS — programme du PC Windows (04/11/2026)
// Lit les profils TikTok et Instagram avec le Chrome de la machine (profil dédié, connecté une fois),
// et dépose les résultats dans Supabase (tables releve_runs + releve_dump). Claude ne fait plus que
// la fusion et la publication, sans aucun navigateur piloté à distance.
//
// Usage :  node releve.js --login     (une seule fois : se connecter à TikTok et Instagram dans la fenêtre)
//          node releve.js             (relevé complet, lancé par le Planificateur de tâches Windows)
//          node releve.js --rapide    (ne lit que les comptes qui ont posté ces 2 derniers jours)
//          node releve.js --test 5    (ne lit que 5 comptes de chaque plateforme, pour vérifier)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SB = 'https://kfmfbsvvjjlrulgxxmkv.supabase.co/rest/v1';
const KEY = 'sb_publishable_XAfjdkxZW08KMXHmsFcxaA_HFGxzlvH'; // clé publique (lecture / dépôt seulement)
const PROFILE = path.join(__dirname, 'chrome-profile');
const LOG = path.join(__dirname, 'releve.log');
const TZ = 'Europe/Paris';

const args = process.argv.slice(2);
const LOGIN = args.includes('--login');
const RAPIDE = args.includes('--rapide');
const TEST = args.includes('--test') ? parseInt(args[args.indexOf('--test') + 1] || '5', 10) : 0;

function paris(d = new Date()) {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour')}${g('minute')}`, iso: `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}` };
}
function log(...a) {
  const line = `[${paris().iso}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sb(method, table, body, query = '') {
  const r = await fetch(`${SB}/${table}${query}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: method === 'POST' ? 'return=minimal,resolution=ignore-duplicates' : 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 409) throw new Error(`Supabase ${method} ${table} → ${r.status} ${await r.text()}`);
  return r;
}
async function sbGet(table, query) {
  const r = await fetch(`${SB}/${table}${query}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`Supabase GET ${table} → ${r.status}`);
  return r.json();
}

// ---- Lecture d'un profil TikTok : renvoie "handle|id36:vues,id36:vues" ou "handle|KO" ou "handle|VIDE"
async function readTikTok(page, handle) {
  try {
    await page.goto(`https://www.tiktok.com/@${handle}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) { log('  tiktok goto', handle, String(e).slice(0, 80)); }
  const out = await page.evaluate(async () => {
    const num = t => { t = (t || '').replace(/\s/g, '').replace(',', '.'); const m = t.match(/([\d.]+)([KkMm])?/); return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1)) : 0; };
    let ko = false;
    for (let i = 0; i < 30; i++) {
      if (document.querySelector('[data-e2e=video-views]')) break;
      if (/Impossible de trouver ce compte|Couldn't find this account|Ce compte est privé|This account is private|Aucun contenu|No content|Aucune vidéo|No videos/i.test(document.body.innerText)) { ko = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    const r = [...document.querySelectorAll('[data-e2e=user-post-item]')].slice(0, 12).map(e => {
      const a = e.querySelector('a[href*="/video/"]');
      if (!a) return null;
      const id = a.getAttribute('href').split('/video/')[1].split('?')[0];
      return BigInt(id).toString(36) + ':' + num(e.querySelector('[data-e2e=video-views]')?.innerText);
    }).filter(Boolean);
    const blocked = /Prêt\(e\) à fermer TikTok|Ready to close TikTok|Access Denied|Accès refusé|captcha|Vérifier que vous êtes/i.test(document.body.innerText);
    return { r, ko, blocked };
  });
  return out;
}

// ---- Lecture d'un profil Instagram : renvoie {code: vues}
async function readInstagram(page, handle) {
  try {
    await page.goto(`https://www.instagram.com/${handle}/reels/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) { log('  insta goto', handle, String(e).slice(0, 80)); }
  await sleep(3500);
  return page.evaluate(async () => {
    const b = {};
    const g = () => document.querySelectorAll('a[href*="/reel/"]').forEach(a => {
      const c = a.href.split('/reel/')[1].split('/')[0];
      const m = (a.innerText || '').replace(/\s/g, '').replace(',', '.').match(/([\d.]+)(k|m)?/i);
      if (m) b[c] = Math.max(b[c] || 0, Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1)));
    });
    g(); scrollTo(0, 3000); await new Promise(r => setTimeout(r, 1500)); g();
    const txt = document.body.innerText;
    return { b, ko: /Page introuvable|Sorry, this page isn|Ce compte est priv|This account is private/i.test(txt), blocked: /réessayez plus tard|Try again later|Connectez-vous|Log in to Instagram/i.test(txt) && !Object.keys(b).length };
  });
}

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.RELEVE_TEST_CHROMIUM ? undefined : 'chrome', headless: !!process.env.RELEVE_TEST_CHROMIUM, viewport: { width: 1280, height: 900 }, locale: 'fr-FR',
    args: ['--disable-blink-features=AutomationControlled', '--window-position=0,0'],
  });
  const page = context.pages()[0] || await context.newPage();

  if (LOGIN) {
    log('MODE CONNEXION : connecte-toi à TikTok puis à Instagram dans la fenêtre, puis ferme-la.');
    await page.goto('https://www.tiktok.com/login');
    const p2 = await context.newPage(); await p2.goto('https://www.instagram.com/accounts/login/');
    await new Promise(r => context.on('close', r));
    log('Connexion enregistrée dans le dossier chrome-profile.');
    return;
  }

  const now = paris();
  const RUN = `r${now.date.replace(/-/g, '')}-${now.hm}`;
  log(`=== Relevé ${RUN} ${RAPIDE ? '(rapide)' : TEST ? `(test ${TEST})` : '(complet)'} ===`);

  // 1. Liste des comptes (table releve_accounts, tenue à jour par Claude)
  let accounts = await sbGet('releve_accounts', '?select=aid,handle,platform&active=eq.true&order=platform,handle');
  let TT = accounts.filter(a => a.platform === 'TikTok');
  let IG = accounts.filter(a => a.platform === 'Instagram');
  if (RAPIDE) {
    // comptes qui ont posté ces 2 derniers jours (liste déposée par Claude dans releve_dump, run 'r2026-recent')
    try {
      const rec = await sbGet('releve_dump', `?run=eq.r2026-recent&select=body&order=id.desc&limit=1`);
      if (rec.length) { const set = new Set(rec[0].body.split('\n')); TT = TT.filter(a => set.has(a.aid)); IG = IG.filter(a => set.has(a.aid)); }
    } catch (e) { log('liste rapide indisponible, relevé complet'); }
  }
  if (TEST) { TT = TT.slice(0, TEST); IG = IG.slice(0, TEST); }
  log(`TikTok ${TT.length} comptes, Instagram ${IG.length} comptes`);
  await sb('POST', 'releve_runs', { id: RUN, n_tt: TT.length, n_ig: IG.length, note: 'PC Windows : etape 1 ok' });
  const note = async t => { try { await sb('PATCH', 'releve_runs', { note: t }, `?id=eq.${RUN}`); } catch (e) { log('note', String(e).slice(0, 80)); } };

  // 2. TikTok
  const ttLines = []; let ttOk = 0, ttKo = 0, ttVide = 0, blockedCount = 0;
  for (let i = 0; i < TT.length; i++) {
    const a = TT[i];
    let x = await readTikTok(page, a.handle);
    if (x.blocked) {
      blockedCount++; log(`  TikTok bloqué sur @${a.handle} (${blockedCount}) : pause 90 s`);
      await sleep(90000); x = await readTikTok(page, a.handle);
      if (x.blocked && blockedCount >= 3) { log('  TikTok bloque 3 fois : on garde ce qui est lu et on passe à Instagram'); await note(`PC Windows : TikTok bloqué après ${i} comptes`); break; }
    }
    if (!x.r.length && !x.ko) { await sleep(2000); x = await readTikTok(page, a.handle); }
    const line = `${a.handle}|${x.r.length ? x.r.join(',') : (x.ko ? 'KO' : 'VIDE')}`;
    ttLines.push(line);
    if (x.r.length) ttOk++; else if (x.ko) ttKo++; else ttVide++;
    if ((i + 1) % 10 === 0) { log(`  TikTok ${i + 1}/${TT.length} (ok ${ttOk}, ko ${ttKo}, vide ${ttVide})`); await note(`PC Windows : TikTok ${i + 1}/${TT.length}`); }
    await sleep(800 + Math.random() * 700);
  }
  if (ttLines.length) await sb('POST', 'releve_dump', { run: RUN, part: 1, body: ttLines.join('\n') });
  log(`TikTok terminé : ok ${ttOk}, ko ${ttKo}, vide ${ttVide}`);
  await note(`PC Windows : etape 3 ok (TT ${ttOk}/${TT.length})`);

  // 3. Instagram
  const igLines = []; let igOk = 0, igKo = 0;
  for (let i = 0; i < IG.length; i++) {
    const a = IG[i];
    const x = await readInstagram(page, a.handle);
    if (x.blocked) { log(`  Instagram demande une vérification sur @${a.handle} : arrêt Instagram (${i} lus)`); await note(`PC Windows : Instagram bloqué après ${i} comptes`); break; }
    igLines.push(`IGX ${a.aid} ${x.ko ? 'KO ' : ''}${JSON.stringify(x.b)}`);
    if (x.ko) igKo++; else if (Object.keys(x.b).length) igOk++;
    if ((i + 1) % 10 === 0) log(`  Instagram ${i + 1}/${IG.length}`);
    await sleep(1500 + Math.random() * 1000);
  }
  if (igLines.length) await sb('POST', 'releve_dump', { run: RUN, part: 2, body: igLines.join('\n') });
  log(`Instagram terminé : ok ${igOk}, ko ${igKo}`);

  // 4. Fin
  await sb('PATCH', 'releve_runs', { finished_at: new Date().toISOString(), note: `PC Windows : etape 5 ok - TT ${ttOk}/${TT.length}, IG ${igOk}/${IG.length}` }, `?id=eq.${RUN}`);
  log(`=== Fin ${RUN} : déposé dans Supabase. Claude publie dans les minutes qui suivent. ===`);
  await context.close();
})().catch(async e => { log('ERREUR', String(e)); process.exit(1); });
