import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { latestIrepArchive, parseIrepArchive, loadIndustrialEmissions } from '../lib/industrial-emissions-source.ts';
import { inventoryFacility, formatEmissionQuantity } from '../lib/industrial-emissions.ts';

// Small synthetic contract fixtures; never shipped as observations.
const establishmentHeaders = 'identifiant;nom_etablissement;numero_siret;code_insee;commune;coordonnees_x;coordonnees_y;code_epsg';
const emissionHeaders = 'identifiant;code_insee;annee_emission;milieu;polluant;quantite;unite';
const establishment = '0006104769;SGL CARBON SA;38970414900027;74208;PASSY;6.728596;45.926387;4326';
const emission = '0006104769;74208;2024;Eau (direct);Benzo (a) pyrène;0.180;kg/an';
function archive({ establishments = [establishment], emissions = [emission], headers = emissionHeaders, extra = {} } = {}) {
  return zipSync({
    '2024/etablissements.csv': strToU8(`${establishmentHeaders}\r\n${establishments.join('\r\n')}\r\n`),
    '2024/emissions.csv': strToU8(`\ufeff${headers}\r\n${emissions.join('\r\n')}\r\n`),
    '2024/Prod_dechets_dangereux.csv': strToU8('Not parsed: not pollutant emissions'),
    ...extra,
  });
}
const catalogue = { annuel: { 2023: { formatFichier: 'zip', lien: 'https://files.georisques.fr/irep/2023.zip' }, 2024: { formatFichier: 'zip', lien: 'https://files.georisques.fr/irep/2024.zip' }, 2025: null, 2026: null } };
const site = { name: 'SGL Carbon', commune: 'Passy', link: 'https://annuaire-entreprises.data.gouv.fr/entreprise/sgl-carbon-sa-389704149', coordinates: { lat: 45.926387, lng: 6.728596 } };

test('latest published complete year is selected, never the catalogue current year', () => {
  assert.deepEqual(latestIrepArchive(catalogue, 2026), { year: 2024, url: 'https://files.georisques.fr/irep/2024.zip' });
  assert.equal(latestIrepArchive(catalogue, 2024).year, 2023);
  assert.throws(() => latestIrepArchive({ annuel: { 2024: { formatFichier: 'zip', lien: 'https://untrusted.example/file.zip' } } }));
  for (const value of [null, {}, { annuel: { 2026: null } }]) assert.throws(() => latestIrepArchive(value));
});
test('parser preserves identifiers, decimals, units, below-threshold and published-zero distinctions', () => {
  const [facility] = parseIrepArchive(archive({ emissions: [emission,
    '0006104769;74208;2024;Air;Poussières totales;< seuil;kg/an',
    '0006104769;74208;2024;Eau (direct);Acénaphtène;0;kg/an',
    '0006104769;74208;2024;Air;Test minuscule;0,00000018;kg/an',
  ] }), 2024);
  assert.equal(facility.id, '0006104769');
  assert.equal(facility.siret, '38970414900027');
  assert.equal(facility.emissions.find(e => e.pollutant === 'Benzo (a) pyrène').quantity, 0.18);
  assert.equal(facility.emissions.find(e => e.pollutant === 'Poussières totales').quantity, '< seuil');
  assert.equal(facility.emissions.find(e => e.pollutant === 'Acénaphtène').quantity, 0);
  assert.equal(facility.emissions.find(e => e.pollutant === 'Test minuscule').quantity, 0.00000018);
  assert.ok(facility.emissions.every(e => e.unit === 'kg/an'));
  assert.equal(formatEmissionQuantity(0.00000018), '0,00000018');
});
test('national register is restricted to both official communes and their polygons', () => {
  const facilities = parseIrepArchive(archive({ establishments: [establishment,
    '0000000001;Servoz;12345678900001;74266;SERVOZ;6.762;45.93;4326',
    '0000000002;Wrong coordinate;12345678900002;74208;PASSY;6.87;45.92;4326',
    '0000000003;Missing coordinate;12345678900003;74208;PASSY;;;4326',
  ] }), 2024);
  assert.deepEqual(facilities.map(f => f.id), ['0006104769']);
});
test('CSV handles quoted delimiters and keeps totals separate from component quantities', () => {
  const [facility] = parseIrepArchive(archive({ emissions: [
    '0006104769;74208;2024;Air;"CO2; total";49100000;kg/an',
    '0006104769;74208;2024;Air;CO2 biomasse;28500000;kg/an',
    '0006104769;74208;2024;Air;CO2 non biomasse;20600000;kg/an',
  ] }), 2024);
  assert.equal(facility.emissions.length, 3);
  assert.equal(facility.emissions.find(e => e.pollutant === 'CO2; total').quantity, 49100000);
});
test('invalid or ambiguous provider data fails closed', () => {
  for (const quantity of ['', '-1', 'NaN', 'Infinity', 'non disponible', '1e999']) {
    assert.throws(() => parseIrepArchive(archive({ emissions: [emission.replace('0.180', quantity)] }), 2024));
  }
  assert.throws(() => parseIrepArchive(archive({ emissions: [emission, emission] }), 2024));
  assert.throws(() => parseIrepArchive(archive({ establishments: [establishment, establishment] }), 2024));
  assert.throws(() => parseIrepArchive(archive({ headers: emissionHeaders.replace('quantite', 'new_quantity') }), 2024));
  assert.throws(() => parseIrepArchive(archive({ emissions: [emission.replace(';2024;', ';2023;')] }), 2024));
  assert.throws(() => parseIrepArchive(archive({ emissions: [emission.replace(';74208;', ';74256;')] }), 2024));
  assert.throws(() => parseIrepArchive(archive({ establishments: [establishment.replace(';4326', ';2154')] }), 2024));
  assert.throws(() => parseIrepArchive(zipSync({}), 2024));
});
test('a company identifier plus unique establishment in the same commune is required', () => {
  const facilities = parseIrepArchive(archive(), 2024);
  assert.equal(inventoryFacility(site, { facilities })?.id, '0006104769');
  assert.equal(inventoryFacility({ ...site, commune: 'Sallanches' }, { facilities }), null);
  assert.equal(inventoryFacility(site, { facilities: [...facilities, { ...facilities[0], id: '0000000001', siret: '38970414900035' }] }), null);
  assert.equal(inventoryFacility({ ...site, name: 'Pechiney Bâtiment', link: 'Questionnaire participatif' }, { facilities }), null);
  assert.equal(inventoryFacility({ ...site, link: 'https://untrusted.example/entreprise/sgl-carbon-sa-389704149' }, { facilities }), null);
  assert.equal(inventoryFacility({ ...site, link: 'https://annuaire-entreprises.data.gouv.fr/entreprise/sgl-carbon-sa-123456789' }, { facilities }), null);
});
test('no emissions is not fabricated zero, and source failures leave the inventory usable', async () => {
  const facilities = parseIrepArchive(archive({ emissions: [] }), 2024);
  assert.equal(facilities[0].emissions.length, 0);
  const calls = [];
  const data = await loadIndustrialEmissions(async url => {
    calls.push(url);
    return calls.length === 1 ? Response.json(catalogue) : new Response(archive());
  });
  assert.equal(data.year, 2024);
  assert.equal(data.facilities.length, 1);
  assert.equal(calls[1], 'https://files.georisques.fr/irep/2024.zip');
  const failed = await loadIndustrialEmissions(async () => new Response('', { status: 500 }));
  assert.deepEqual(failed.facilities, []);
  assert.equal(failed.year, null);
  assert.ok(failed.error);
  const oversize = await loadIndustrialEmissions(async () => new Response('{}', { headers: { 'content-length': '999999999' } }));
  assert.ok(oversize.error);
});
