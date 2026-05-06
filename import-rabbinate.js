const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/04_SAFETY_DATA/data_gov_il/rabbinate_imported_foods.json', 'utf8'));
console.log(`Rabbinate records: ${data.length}`);

const tmpFile = path.join(__dirname, 'tmp_rab.sql');
const BATCH = 50;
let imported = 0;

function esc(v) {
  if (v == null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''").substring(0, 500)}'`;
}

for (let i = 0; i < data.length; i += BATCH) {
  const batch = data.slice(i, i + BATCH);
  const values = batch.map(r =>
    `(${esc(r.name4)},${esc(r.name5)},${esc(r.name1)},${esc(r.name2)},${esc(r.name3)},${esc(r.name6)},${esc(r.name7)},${esc(r.name8)},${esc(r.name9)},${esc(r.name10)},${esc(r.description)})`
  ).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO rabbinate_imports (product_name_he,product_name_en,importer,country,kashrut_body,manufacturer,barcode,cert_expiry,cert_start,kashrut_type,description) VALUES ${values}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
  } catch(e) {}

  if (imported % 5000 === 0 || i + BATCH >= data.length) {
    console.log(`${imported}/${data.length}`);
  }
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} rabbinate import records.`);
