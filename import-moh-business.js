const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tmpFile = path.join(__dirname, 'tmp_moh.sql');

function esc(v) {
  if (v == null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''").substring(0, 500)}'`;
}

function runSQL(sql) {
  fs.writeFileSync(tmpFile, sql);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    return true;
  } catch(e) { return false; }
}

// === Manufacturers ===
console.log('=== MOH Food Manufacturers ===');
runSQL("CREATE TABLE IF NOT EXISTS il_food_manufacturers (id INTEGER PRIMARY KEY AUTOINCREMENT, license INTEGER, name TEXT, expire_date TEXT, gmp_expire_date TEXT, food_type TEXT, account_type TEXT, health_district TEXT, city TEXT, address TEXT)");

const mfg = JSON.parse(fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/04_SAFETY_DATA/data_gov_il/moh_food_manufacturers.json', 'utf8'));
console.log(`Records: ${mfg.length}`);

let imp1 = 0;
for (let i = 0; i < mfg.length; i += 50) {
  const batch = mfg.slice(i, i + 50);
  const vals = batch.map(r => `(${esc(r.license)},${esc(r.title)},${esc(r.expire_date)},${esc(r.gmp_expire_date)},${esc(r.ProductActivityFoodType)},${esc(r.accountType)},${esc(r.health_district_desc)},${esc(r.city)},${esc(r.Addr)})`).join(',\n');
  if (runSQL(`INSERT INTO il_food_manufacturers (license,name,expire_date,gmp_expire_date,food_type,account_type,health_district,city,address) VALUES ${vals}`)) imp1 += batch.length;
  if (imp1 % 1000 === 0 || i + 50 >= mfg.length) console.log(`  ${imp1}/${mfg.length}`);
}

// === Importers ===
console.log('\n=== MOH Food Importers ===');
runSQL("CREATE TABLE IF NOT EXISTS il_food_importers (id INTEGER PRIMARY KEY AUTOINCREMENT, reg_number INTEGER, name TEXT, address TEXT, importer_type TEXT, trusted TEXT)");

const imp = JSON.parse(fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/04_SAFETY_DATA/data_gov_il/moh_food_importers.json', 'utf8'));
console.log(`Records: ${imp.length}`);

let imp2 = 0;
for (let i = 0; i < imp.length; i += 50) {
  const batch = imp.slice(i, i + 50);
  const vals = batch.map(r => `(${esc(r.Regnum)},${esc(r.importer_name)},${esc(r.Address)},${esc(r.importer_type_name)},${esc(r.Trust_description)})`).join(',\n');
  if (runSQL(`INSERT INTO il_food_importers (reg_number,name,address,importer_type,trusted) VALUES ${vals}`)) imp2 += batch.length;
  if (imp2 % 1000 === 0 || i + 50 >= imp.length) console.log(`  ${imp2}/${imp.length}`);
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`\nDone! Manufacturers:${imp1} Importers:${imp2} = ${imp1+imp2} total`);
