const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2';
const tmpFile = path.join(__dirname, 'tmp_cosing.sql');

function runSQL(sql) {
  fs.writeFileSync(tmpFile, sql);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    return true;
  } catch(e) { return false; }
}

function parseTSV(filePath, skipLines) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.replace(/\r/g, '').split('\n').slice(skipLines).filter(l => l.trim());
  return lines.map(line => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
      else { current += line[i]; }
    }
    fields.push(current.trim());
    return fields;
  });
}

function esc(v) {
  if (v == null || v === '' || v === '-') return 'NULL';
  return `'${String(v).replace(/'/g, "''").substring(0, 500)}'`;
}

// === ANNEX II (Banned) ===
console.log('=== Annex II (Banned) ===');
const a2 = parseTSV(path.join(BASE, 'COSING_Annex_II_v2.txt'), 5);
console.log(`Parsed: ${a2.length} rows`);
let imp2 = 0;
for (let i = 0; i < a2.length; i += 50) {
  const batch = a2.slice(i, i + 50);
  const vals = batch.map(r => `(${esc(r[0])},${esc(r[1])},${esc(r[2])},${esc(r[3])},${esc(r[4])},${esc(r[9])},${esc(r[10])})`).join(',\n');
  if (runSQL(`INSERT INTO cosing_annex_ii (ref_number,chemical_name,cas_number,ec_number,regulation,cmr,update_date) VALUES ${vals}`)) {
    imp2 += batch.length;
  }
  if (imp2 % 500 === 0 || i + 50 >= a2.length) console.log(`  ${imp2}/${a2.length}`);
}

// === ANNEX III (Restricted) ===
console.log('\n=== Annex III (Restricted) ===');
const a3 = parseTSV(path.join(BASE, 'COSING_Annex_III_v2.txt'), 5);
console.log(`Parsed: ${a3.length} rows`);
let imp3 = 0;
for (let i = 0; i < a3.length; i += 50) {
  const batch = a3.slice(i, i + 50);
  const vals = batch.map(r => `(${esc(r[0])},${esc(r[1])},${esc(r[2])},${esc(r[3])},${esc(r[4])},${esc(r[5])},${esc(r[6])},${esc(r[7])},${esc(r[8])},${esc(r[9])},${esc(r[14])},${esc(r[15])})`).join(',\n');
  if (runSQL(`INSERT INTO cosing_annex_iii (ref_number,chemical_name,inci_name,cas_number,ec_number,product_type,max_concentration,other_conditions,warnings,regulation,cmr,update_date) VALUES ${vals}`)) {
    imp3 += batch.length;
  }
  if (imp3 % 500 === 0 || i + 50 >= a3.length) console.log(`  ${imp3}/${a3.length}`);
}

// === ANNEX IV (Colorants) ===
console.log('\n=== Annex IV (Colorants) ===');
const a4 = parseTSV(path.join(BASE, 'COSING_Annex_IV_v2.txt'), 5);
console.log(`Parsed: ${a4.length} rows`);
let imp4 = 0;
const vals4 = a4.map(r => `(${esc(r[0])},${esc(r[1])},${esc(r[2])},${esc(r[3])},${esc(r[4])},${esc(r[5])},${esc(r[6])},${esc(r[7])},${esc(r[8])},${esc(r[10])})`).join(',\n');
if (vals4 && runSQL(`INSERT INTO cosing_annex_iv (ref_number,substance,cas_number,ec_number,colour,product_type,max_concentration,other_conditions,regulation,update_date) VALUES ${vals4}`)) {
  imp4 = a4.length;
}
console.log(`  ${imp4}/${a4.length}`);

// === ANNEX V (Preservatives) ===
console.log('\n=== Annex V (Preservatives) ===');
const a5 = parseTSV(path.join(BASE, 'COSING_Annex_V_v2.txt'), 5);
console.log(`Parsed: ${a5.length} rows`);
let imp5 = 0;
const vals5 = a5.map(r => `(${esc(r[0])},${esc(r[1])},${esc(r[2])},${esc(r[3])},${esc(r[4])},${esc(r[5])},${esc(r[6])},${esc(r[7])},${esc(r[8])},${esc(r[10])})`).join(',\n');
if (vals5 && runSQL(`INSERT INTO cosing_annex_v (ref_number,substance,cas_number,ec_number,product_type,max_concentration,other_conditions,warnings,regulation,update_date) VALUES ${vals5}`)) {
  imp5 = a5.length;
}
console.log(`  ${imp5}/${a5.length}`);

// === ANNEX VI (UV Filters) ===
console.log('\n=== Annex VI (UV Filters) ===');
const a6 = parseTSV(path.join(BASE, 'COSING_Annex_VI_v2.txt'), 5);
console.log(`Parsed: ${a6.length} rows`);
let imp6 = 0;
const vals6 = a6.map(r => `(${esc(r[0])},${esc(r[1])},${esc(r[2])},${esc(r[3])},${esc(r[4])},${esc(r[5])},${esc(r[6])},${esc(r[7])},${esc(r[8])},${esc(r[10])})`).join(',\n');
if (vals6 && runSQL(`INSERT INTO cosing_annex_vi (ref_number,substance,cas_number,ec_number,product_type,max_concentration,other_conditions,warnings,regulation,update_date) VALUES ${vals6}`)) {
  imp6 = a6.length;
}
console.log(`  ${imp6}/${a6.length}`);

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`\nDONE! II:${imp2} III:${imp3} IV:${imp4} V:${imp5} VI:${imp6} = ${imp2+imp3+imp4+imp5+imp6} total`);
