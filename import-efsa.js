const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const tmpFile = path.join(__dirname, 'tmp_efsa.sql');

function runSQL(sql, label) {
  fs.writeFileSync(tmpFile, sql);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 60000, stdio: 'pipe', shell: true
    });
    if (label) console.log(label);
    return true;
  } catch(e) {
    console.error(`FAIL [${label}]: ${e.stderr?.toString().substring(0, 150)}`);
    return false;
  }
}

// === REFERENCE POINTS ===
console.log('=== Importing EFSA Reference Points ===');
runSQL("CREATE TABLE IF NOT EXISTS efsa_reference_points (id INTEGER PRIMARY KEY AUTOINCREMENT, substance TEXT NOT NULL, author TEXT, year INTEGER, study TEXT, test_type TEXT, species TEXT, route TEXT, duration_days INTEGER, endpoint TEXT, qualifier TEXT, value REAL, unit TEXT, effect TEXT)", "Table created");

const wb1 = XLSX.readFile(path.resolve('C:/BENDA_PROJECT/ROOTS_BY_BENDA/04_SAFETY_DATA/efsa_openfoodtox/ReferencePoints_KJ_2023.xlsx'));
const rp = XLSX.utils.sheet_to_json(wb1.Sheets['REFERENCEPOINTS']);
console.log(`Records: ${rp.length}`);

const BATCH = 50;
let imported1 = 0;
const SKIP_RP = 1550; // already imported before failure

for (let i = SKIP_RP; i < rp.length; i += BATCH) {
  const batch = rp.slice(i, i + BATCH);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''").substring(0, 300)}'` : v;
    return `(${esc(r.Substance)},${esc(r.Author)},${esc(r.Year)},${esc(r.Study)},${esc(r.TestType)},${esc(r.Species)},${esc(r.Route)},${esc(r.DurationDays)},${esc(r.Endpoint)},${esc(r.qualifier)},${esc(r.value)},${esc(r.unit)},${esc(r.Effect)})`;
  }).join(',\n');

  if (runSQL(`INSERT INTO efsa_reference_points (substance,author,year,study,test_type,species,route,duration_days,endpoint,qualifier,value,unit,effect) VALUES ${values}`)) {
    imported1 += batch.length;
  }
  if (imported1 % 2000 === 0 || i + BATCH >= rp.length) console.log(`RefPoints: ${imported1}/${rp.length}`);
}

// === REFERENCE VALUES ===
console.log('\n=== Importing EFSA Reference Values ===');
runSQL("CREATE TABLE IF NOT EXISTS efsa_reference_values (id INTEGER PRIMARY KEY AUTOINCREMENT, substance TEXT NOT NULL, author TEXT, year INTEGER, assessment TEXT, qualifier TEXT, value REAL, unit TEXT, population TEXT)", "Table created");

const wb2 = XLSX.readFile(path.resolve('C:/BENDA_PROJECT/ROOTS_BY_BENDA/04_SAFETY_DATA/efsa_openfoodtox/ReferenceValues_KJ_2023.xlsx'));
const rv = XLSX.utils.sheet_to_json(wb2.Sheets['REFERENCEVALUES']);
console.log(`Records: ${rv.length}`);

let imported2 = 0;

for (let i = 0; i < rv.length; i += BATCH) {
  const batch = rv.slice(i, i + BATCH);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''").substring(0, 300)}'` : v;
    return `(${esc(r.Substance)},${esc(r.Author)},${esc(r.Year)},${esc(r.Assessment)},${esc(r.qualfier)},${esc(r.value)},${esc(r.unit)},${esc(r.Population)})`;
  }).join(',\n');

  if (runSQL(`INSERT INTO efsa_reference_values (substance,author,year,assessment,qualifier,value,unit,population) VALUES ${values}`)) {
    imported2 += batch.length;
  }
  if (imported2 % 2000 === 0 || i + BATCH >= rv.length) console.log(`RefValues: ${imported2}/${rv.length}`);
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`\nDone! ${imported1} reference points + ${imported2} reference values = ${imported1 + imported2} total.`);
