const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const wb = XLSX.readFile(path.resolve('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/Karmaus_SuppFile1_Chemical_Inventories.xlsx'));
const tmpFile = path.join(__dirname, 'tmp_kex.sql');

function esc(v) {
  if (v == null || v === '' || v === 'pending') return 'NULL';
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

// === EAFUS (3,983 FDA substances) ===
console.log('=== EAFUS ===');
runSQL("CREATE TABLE IF NOT EXISTS fda_eafus (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, definition TEXT)");
const eafus = XLSX.utils.sheet_to_json(wb.Sheets['EAFUS']);
console.log(`Records: ${eafus.length}`);

// Check actual field names
console.log('Fields:', Object.keys(eafus[0]).join(', '));
console.log('Sample:', JSON.stringify(eafus[0]).substring(0, 200));
console.log('Sample2:', JSON.stringify(eafus[5]).substring(0, 200));

// The EAFUS sheet seems to have Label/Definition format - let me import what's there
let imp1 = 0;
for (let i = 0; i < eafus.length; i += 100) {
  const batch = eafus.slice(i, i + 100);
  const vals = batch.map(r => `(${esc(r.Label || r[Object.keys(r)[0]])},${esc(r.Definition || r[Object.keys(r)[1]])})`).join(',\n');
  if (runSQL(`INSERT INTO fda_eafus (label, definition) VALUES ${vals}`)) imp1 += batch.length;
  if (imp1 % 1000 === 0 || i + 100 >= eafus.length) console.log(`  ${imp1}/${eafus.length}`);
}

// === Pesticide (1,809 with CAS + DTXSID) ===
console.log('\n=== Pesticide ===');
runSQL("CREATE TABLE IF NOT EXISTS karmaus_pesticides (id INTEGER PRIMARY KEY AUTOINCREMENT, cas_number TEXT, preferred_name TEXT)");
const pest = XLSX.utils.sheet_to_json(wb.Sheets['Pesticide']);
console.log(`Records: ${pest.length}`);

let imp2 = 0;
for (let i = 0; i < pest.length; i += 100) {
  const batch = pest.slice(i, i + 100);
  const vals = batch.map(r => `(${esc(r.CASRN)},${esc(r['Preferred Name'])})`).join(',\n');
  if (runSQL(`INSERT INTO karmaus_pesticides (cas_number, preferred_name) VALUES ${vals}`)) imp2 += batch.length;
  if (imp2 % 500 === 0 || i + 100 >= pest.length) console.log(`  ${imp2}/${pest.length}`);
}

// === FDA GRN with CAS (674 records) ===
console.log('\n=== FDA GRN with CAS ===');
runSQL("CREATE TABLE IF NOT EXISTS karmaus_fda_grn (id INTEGER PRIMARY KEY AUTOINCREMENT, grn_number INTEGER, substance_name TEXT, cas_number TEXT)");
const grn = XLSX.utils.sheet_to_json(wb.Sheets['FDA GRN']);
console.log(`Records: ${grn.length}`);

let imp3 = 0;
const grnVals = grn.map(r => `(${esc(r['GRAS Notice No. (GRN#)'])},${esc(r['Name of Substance'])},${esc(r['CAS Reg. No.'])})`).join(',\n');
if (runSQL(`INSERT INTO karmaus_fda_grn (grn_number, substance_name, cas_number) VALUES ${grnVals}`)) imp3 = grn.length;
console.log(`  ${imp3}/${grn.length}`);

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`\nDone! EAFUS:${imp1} Pesticide:${imp2} FDA_GRN:${imp3} = ${imp1+imp2+imp3} total`);
