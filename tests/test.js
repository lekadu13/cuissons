// Tests de bout en bout de la version web (Chromium headless).
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(path.join(__dirname, '..', 'source', 'cuissons.html'), 'utf8');
const page_html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + src + '</body></html>';
const file = path.join(__dirname, 'build-test.html');
fs.writeFileSync(file, page_html);
const url = process.env.TEST_URL || ('file://' + file);

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n   ' + (e && e.message)); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(url);
  const S = () => page.evaluate(() => window.__pdo.state());
  const adv = ms => page.evaluate(ms => window.__pdo.advance(ms), ms);
  const tap = async sel => { await page.locator(sel).first().click(); await page.waitForTimeout(750); };

  async function pick(posIndex, name) {
    await page.locator('button.slot[data-pos="' + posIndex + '"]').click();
    await page.locator('.picker button', { hasText: new RegExp('^' + name + '$') }).click();
  }
  async function home() { await page.evaluate(() => window.__pdo.go({ name: 'home' })); }
  async function openFryer(n) { await home(); await page.waitForTimeout(750); await page.locator('button.fryer[data-n="' + n + '"]').click(); await page.waitForTimeout(750); }

  await t('Accueil : deux friteuses disponibles, historique et test visibles', async () => {
    assert.strictEqual(await page.locator('button.fryer').count(), 2);
    assert.match(await page.locator('button.fryer[data-n="1"]').innerText(), /Friteuse 1[\s\S]*Disponible/i);
    assert.ok(await page.locator('[data-act="history"]').isVisible());
    assert.ok(await page.locator('[data-act="test"]').first().isVisible());
  });

  await t('Panier vide : Démarrer désactivé, aucun cycle', async () => {
    await openFryer(1);
    assert.ok(await page.locator('[data-act="start"]').isDisabled());
    assert.strictEqual((await S()).cycles.length, 0);
  });

  await t('Panier : orientation ARRIÈRE en haut, DEVANT en bas', async () => {
    const edges = await page.locator('.basket .edge').allInnerTexts();
    assert.deepStrictEqual(edges, ['ARRIÈRE', 'DEVANT — CÔTÉ UTILISATEUR']);
    const pos = await page.locator('.basket .slot .pos').allInnerTexts();
    assert.deepStrictEqual(pos, ['Arrière gauche', 'Arrière droite', 'Milieu gauche', 'Milieu droite', 'Avant gauche', 'Avant droite']);
  });

  await t('Brouillon sauvegardé avant démarrage et après relance', async () => {
    await pick(0, 'Ragù'); await pick(5, 'Bianca'); await pick(2, 'Ragù');
    await page.selectOption('#min-1', '8'); await page.selectOption('#sec-1', '30');
    await page.reload();
    const s = await S();
    assert.deepStrictEqual(s.fryers[0].draft, ['f-ragu', null, 'f-ragu', null, null, 'f-bianca']);
    assert.strictEqual(s.fryers[0].duration, 510);
  });

  await t('Double appui sur Démarrer : un seul cycle', async () => {
    await openFryer(1);
    await page.locator('[data-act="start"]').dblclick();
    await page.waitForTimeout(750);
    const s = await S();
    assert.strictEqual(s.cycles.length, 1);
    assert.strictEqual(s.cycles[0].number, 1);
    assert.strictEqual(s.cycles[0].status, 'en_cours');
    assert.strictEqual(s.cycles[0].plannedEnd - s.cycles[0].startedAt, 510000);
    assert.ok(await page.locator('.huge').isVisible());
    assert.match(await page.locator('.siri').innerText(), /Minuteur Friteuse 1, 8 minutes 30 secondes/);
  });

  await t('Pendant la cuisson : disposition verrouillée, correction tracée', async () => {
    assert.strictEqual(await page.locator('button.slot').count(), 0, 'aucun emplacement cliquable');
    await tap('[data-act="fixask"]'); await tap('#lok');
    await pick(5, 'Nero');
    const c = (await S()).cycles[0];
    assert.strictEqual(c.slots[5].name, 'Nero');
    assert.strictEqual(c.corrections.length, 1);
    assert.strictEqual(c.corrections[0].before.name, 'Bianca');
    assert.strictEqual(c.corrections[0].after.name, 'Nero');
    await tap('[data-act="fixdone"]');
  });

  await t('Friteuse 2 démarrée en décalé, la 1 continue', async () => {
    await adv(120000);
    await openFryer(2);
    await pick(1, 'Chorizo');
    await page.selectOption('#min-2', '5'); await page.selectOption('#sec-2', '0');
    await tap('[data-act="start"]');
    const s = await S();
    assert.strictEqual(s.cycles.length, 2);
    await home();
    assert.match(await page.locator('button.fryer[data-n="1"]').innerText(), /Cuisson en cours[\s\S]*06:[23]\d/i);
    assert.match(await page.locator('button.fryer[data-n="2"]').innerText(), /Cuisson en cours[\s\S]*0[45]:\d\d/i);
  });

  await t('Fin de la Friteuse 2 : alerte, statut terminé, Friteuse 1 non affectée', async () => {
    await adv(300000);
    assert.ok(await page.locator('#alarm').isVisible(), 'écran d\'alarme');
    assert.match(await page.locator('#alarm').innerText(), /FRITEUSE 2 PRÊTE/);
    const s = await S();
    const c2 = s.cycles.find(c => c.fryer === 2);
    assert.strictEqual(c2.status, 'termine');
    assert.strictEqual(c2.finishedAt, c2.plannedEnd);
    assert.strictEqual(s.cycles.find(c => c.fryer === 1).status, 'en_cours');
  });

  await t('Arrêter la sonnerie ne retire pas le panier', async () => {
    await tap('[data-act="silence"]');
    assert.ok(await page.locator('#alarm').isHidden());
    const c2 = (await S()).cycles.find(c => c.fryer === 2);
    assert.strictEqual(c2.removedAt, null);
    assert.match(await page.locator('button.fryer[data-n="2"]').innerText(), /À retirer[\s\S]*PRÊTE/i);
  });

  await t('Temps écoulé depuis la fin affiché', async () => {
    await adv(65000);
    assert.match(await page.locator('button.fryer[data-n="2"]').innerText(), /depuis 1 min 0\d s/);
  });

  await t('Fermeture puis relance : cuissons et échéances retrouvées', async () => {
    await page.reload();
    const s = await S();
    assert.strictEqual(s.cycles.length, 2);
    // Après relance l'horloge de test repart à zéro : l'état vient bien de l'heure de fin persistée.
    const c1 = s.cycles.find(c => c.fryer === 1);
    assert.strictEqual(c1.status, 'en_cours');
    assert.match(await page.locator('button.fryer[data-n="2"]').innerText(), /À retirer/i);
  });

  await t('Cycle terminé pendant la fermeture : état terminé, pas de doublon', async () => {
    await page.evaluate(() => window.__pdo.advance(20 * 60 * 1000));
    await page.reload();
    // l'avance d'horloge est perdue au rechargement : on la réapplique avant lecture
    await page.evaluate(() => window.__pdo.advance(20 * 60 * 1000));
    const s = await S();
    assert.strictEqual(s.cycles.length, 2);
    assert.ok(s.cycles.every(c => c.status === 'termine'));
    await page.evaluate(() => window.__pdo.advance(1000));
    assert.strictEqual((await S()).cycles.length, 2);
  });

  await t('Les deux friteuses prêtes ensemble : retirer la 1 laisse la 2', async () => {
    await openFryer(1);
    await tap('[data-act="removed"]'); await tap('#lok');
    const s = await S();
    const c1 = s.cycles.find(c => c.fryer === 1);
    assert.ok(c1.removedAt > c1.plannedEnd, 'retrait réel distinct de la fin prévue');
    assert.strictEqual(s.fryers[0].active, null);
    assert.ok(s.fryers[1].active, 'Friteuse 2 toujours à retirer');
    assert.ok(await page.locator('[data-act="new"]').isVisible());
    assert.ok(await page.locator('[data-act="redo"]').isVisible());
    assert.strictEqual(s.cycles.length, 2, 'pas de démarrage automatique');
  });

  await t('Refaire le même panier recopie la disposition corrigée sans démarrer', async () => {
    await tap('[data-act="redo"]');
    const s = await S();
    assert.deepStrictEqual(s.fryers[0].draft, ['f-ragu', null, 'f-ragu', null, null, 'f-nero']);
    assert.strictEqual(s.fryers[0].duration, 510);
    assert.strictEqual(s.cycles.length, 2);
  });

  await t('Cycle 2 numéroté, cycle précédent retrouvé pendant la cuisson', async () => {
    await tap('[data-act="start"]');
    const s = await S();
    const c = s.cycles.filter(c => c.fryer === 1).sort((a, b) => a.startedAt - b.startedAt);
    assert.strictEqual(c[1].number, 2);
    await page.locator('[data-act="cycle"]').first().click();
    assert.match(await page.locator('h1').innerText(), /Friteuse 1 · Cycle 1/);
    const names = await page.locator('.basket .slot .name').allInnerTexts();
    assert.deepStrictEqual(names, ['Ragù', 'Vide', 'Ragù', 'Vide', 'Vide', 'Nero']);
    assert.match(await page.locator('.panel').nth(2).innerText(), /Avant droite : Bianca → Nero/);
  });

  await t('Annuler une cuisson : statut annulé, panier remis en brouillon', async () => {
    await openFryer(1);
    await tap('[data-act="cancel"]'); await tap('#lok');
    const s = await S();
    const c = s.cycles.find(x => x.status === 'annule');
    assert.ok(c && c.cancelledAt);
    assert.strictEqual(s.fryers[0].active, null);
    assert.deepStrictEqual(s.fryers[0].draft, ['f-ragu', null, 'f-ragu', null, null, 'f-nero']);
  });

  await t('Historique : récents en premier, filtres friteuse et date', async () => {
    await home(); await tap('[data-act="history"]');
    assert.strictEqual(await page.locator('.hrow').count(), 3);
    const first = await page.locator('.hrow').first().innerText();
    assert.match(first, /Friteuse 1 · Cycle 2[\s\S]*Annulé/i);
    await page.locator('[data-act="hf"][data-v="2"]').click();
    assert.strictEqual(await page.locator('.hrow').count(), 1);
    await page.fill('#hday', '2020-01-01'); await page.dispatchEvent('#hday', 'change');
    assert.strictEqual(await page.locator('.hrow').count(), 0);
    await tap('[data-act="hall"]');
    assert.strictEqual(await page.locator('.hrow').count(), 1);
  });

  await t('Saveurs : renommer et archiver ne modifie pas l\'historique', async () => {
    await home(); await tap('[data-act="settings"]');
    await page.locator('.flv', { hasText: 'Ragù' }).locator('[data-act="fedit"]').click();
    await page.fill('#fname', 'Ragù maison');
    await page.locator('[data-col="1565C0"]').click();
    await tap('#fsave');
    await page.locator('.flv', { hasText: 'Chorizo' }).locator('[data-act="farch"]').click();
    await tap('[data-act="fadd"]'); await page.fill('#fname', 'Pistache'); await tap('#fsave');
    const s = await S();
    assert.strictEqual(s.flavors.find(f => f.id === 'f-ragu').name, 'Ragù maison');
    assert.ok(s.flavors.find(f => f.id === 'f-chorizo').archived);
    assert.ok(s.flavors.some(f => f.name === 'Pistache'));
    const c1 = s.cycles.find(c => c.fryer === 1 && c.number === 1);
    assert.strictEqual(c1.slots[0].name, 'Ragù');
    assert.strictEqual(c1.slots[0].color, '9B1C1C');
    assert.strictEqual(s.cycles.find(c => c.fryer === 2).slots[1].name, 'Chorizo');
    await openFryer(1);
    await page.locator('button.slot[data-pos="1"]').click();
    const choices = await page.locator('.picker button').allInnerTexts();
    assert.ok(!choices.includes('Chorizo') && choices.includes('Pistache') && choices.includes('Ragù maison'));
    await page.locator('.sheet [data-act="lclose"]').click();
  });

  await t('Sauvegarde exportée puis restaurée sur un "autre téléphone"', async () => {
    const backup = await page.evaluate(() => JSON.stringify({ app: 'PalleDoroCuissons', data: window.__pdo.state() }));
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await p2.goto(url);
    assert.strictEqual((await p2.evaluate(() => window.__pdo.state())).cycles.length, 0);
    await p2.evaluate(() => window.__pdo.go({ name: 'settings' }));
    await p2.fill('#imptext', 'pas une sauvegarde');
    await p2.locator('[data-act="imptext"]').click(); await p2.locator('#lok').click(); await p2.waitForTimeout(750);
    assert.strictEqual((await p2.evaluate(() => window.__pdo.state())).cycles.length, 0, 'texte invalide refusé sans rien effacer');
    await p2.evaluate(() => window.__pdo.go({ name: 'settings' }));
    await p2.fill('#imptext', backup);
    await p2.locator('[data-act="imptext"]').click(); await p2.locator('#lok').click(); await p2.waitForTimeout(750);
    const s2 = await p2.evaluate(() => window.__pdo.state());
    assert.strictEqual(s2.cycles.length, 3);
    assert.strictEqual(s2.flavors.find(f => f.id === 'f-ragu').name, 'Ragù maison');
    await ctx2.close();
  });

  await t('Fonctionne hors ligne (aucune requête réseau nécessaire)', async () => {
    if (url.startsWith('http')) { await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForTimeout(500); }
    await ctx.setOffline(true);
    await page.reload();
    await openFryer(1);
    await tap('[data-act="start"]');
    const s = await S();
    assert.ok(s.cycles.some(c => c.status === 'en_cours'));
    await ctx.setOffline(false);
  });

  await t('Pas de défilement horizontal à 390 px', async () => {
    for (const v of ['home', 'history', 'settings']) {
      await page.evaluate(v => window.__pdo.go({ name: v }), v);
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(w <= 390, v + ' : ' + w);
    }
  });

  await t('Aucune erreur JavaScript', async () => { assert.deepStrictEqual(errors, []); });

  await home();
  await page.screenshot({ path: path.join(__dirname, 'shot-home.png'), fullPage: true });
  await openFryer(2);
  await page.screenshot({ path: path.join(__dirname, 'shot-ready.png'), fullPage: true });
  await browser.close();
  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})();
