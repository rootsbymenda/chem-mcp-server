const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const wb = XLSX.readFile(path.resolve('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/Karmaus_SuppFile1_Chemical_Inventories.xlsx'));
const data = XLSX.utils.sheet_to_json(wb.Sheets['FEMA GRAS']);
console.log(`FEMA GRAS records: ${data.length}`);

const BATCH_SIZE = 50;
let imported = 0;
const tmpFile = path.join(__dirname, 'tmp_fema.sql');

for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' || v === 'pending' ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v;
    return `(${esc(r['FEMA No'])},${esc(r['CAS No.'])},${esc(r['Primary Name'])},${esc(r['GRAS Publication'])})`;
  }).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO fema_gras (fema_number,cas_number,primary_name,gras_publication) VALUES ${values}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
    if (imported % 500 === 0 || i + BATCH_SIZE >= data.length) {
      console.log(`Imported ${imported}/${data.length}`);
    }
  } catch(e) {
    console.error(`Error batch ${i}: ${e.stderr?.toString().substring(0, 150)}`);
  }
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} FEMA GRAS substances imported.`);
