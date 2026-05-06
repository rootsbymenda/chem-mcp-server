const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const wb = XLSX.readFile(path.resolve('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/Karmaus_SuppFile1_Chemical_Inventories.xlsx'));

// Import the 8659 food CAS numbers with categories
const data = XLSX.utils.sheet_to_json(wb.Sheets['8659_FOOD_CASRN']);
console.log(`Food CAS records: ${data.length}`);
console.log('Sample:', JSON.stringify(data[0]));

// Also import the 1530 with DSSTox IDs
const data2 = XLSX.utils.sheet_to_json(wb.Sheets['1530_FOOD_CASRN']);
console.log(`Food CAS+DSSTox records: ${data2.length}`);
console.log('Sample:', JSON.stringify(data2[0]));

// Create table
const tmpFile = path.join(__dirname, 'tmp_karmaus.sql');
fs.writeFileSync(tmpFile, "CREATE TABLE IF NOT EXISTS food_cas_crosswalk (id INTEGER PRIMARY KEY AUTOINCREMENT, cas_number TEXT NOT NULL, category TEXT, dsstox_id TEXT, chemical_name TEXT)");
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
    cwd: __dirname, timeout: 15000, stdio: 'pipe', shell: true
  });
  console.log('Table created');
} catch(e) {
  console.error('Table error:', e.stderr?.toString().substring(0, 150));
}

// Import 8659 records
const BATCH_SIZE = 100;
let imported = 0;

for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
    return `(${esc(r['CASRN'])},${esc(r['Karmaus Category'])},NULL,NULL)`;
  }).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO food_cas_crosswalk (cas_number,category,dsstox_id,chemical_name) VALUES ${values}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
    if (imported % 1000 === 0 || i + BATCH_SIZE >= data.length) {
      console.log(`8659 set: ${imported}/${data.length}`);
    }
  } catch(e) {
    console.error(`Error batch ${i}: ${e.stderr?.toString().substring(0, 100)}`);
  }
}

// Import 1530 records with DSSTox IDs
let imported2 = 0;
for (let i = 0; i < data2.length; i += BATCH_SIZE) {
  const batch = data2.slice(i, i + BATCH_SIZE);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
    return `(${esc(r['CASRN'])},${esc(r['Karmaus Category'])},${esc(r['DSSTox_ID'])},${esc(r['Chemical Name'])})`;
  }).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO food_cas_crosswalk (cas_number,category,dsstox_id,chemical_name) VALUES ${values}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported2 += batch.length;
    if (imported2 % 500 === 0 || i + BATCH_SIZE >= data2.length) {
      console.log(`1530 set: ${imported2}/${data2.length}`);
    }
  } catch(e) {
    console.error(`Error batch ${i}: ${e.stderr?.toString().substring(0, 100)}`);
  }
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} + ${imported2} = ${imported + imported2} total food CAS crosswalk records.`);
