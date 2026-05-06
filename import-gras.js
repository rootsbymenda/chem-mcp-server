const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/GRASNotices.csv', 'utf8');
const lines = raw.replace(/\r/g, '').split('\n').slice(3); // skip 3 header lines (info, blank, column headers)
console.log(`Total GRAS lines: ${lines.length}`);

const records = [];
for (const line of lines) {
  if (!line.trim()) continue;
  // CSV parsing - handle quoted fields
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  fields.push(current.trim());

  if (fields.length < 5) continue;

  let grn = fields[0].replace(/=T\("(\d+)"\)/, '$1').replace(/"/g, '').trim();
  grn = grn.replace(/^=T\(/, '').replace(/\)$/, '').replace(/"/g, '').trim();
  if (!grn || isNaN(parseInt(grn))) continue;

  records.push({
    grn: grn,
    substance: (fields[1] || '').replace(/"/g, '').trim(),
    intended_use: (fields[2] || '').replace(/"/g, '').trim().substring(0, 500),
    basis: (fields[3] || '').replace(/"/g, '').trim(),
    notifier: (fields[4] || '').replace(/"/g, '').trim(),
    filing_date: (fields[6] || '').replace(/"/g, '').trim(),
    closure_date: (fields[14] || '').replace(/"/g, '').trim(),
    fda_response: (fields[16] || '').replace(/"/g, '').trim().substring(0, 200),
  });
}

console.log(`Parsed ${records.length} GRAS notices`);

const BATCH_SIZE = 50;
let imported = 0;
const tmpFile = path.join(__dirname, 'tmp_gras.sql');

for (let i = 0; i < records.length; i += BATCH_SIZE) {
  const batch = records.slice(i, i + BATCH_SIZE);
  const values = batch.map(r => {
    const esc = (v) => v == null || v === '' ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
    return `(${esc(r.grn)},${esc(r.substance)},${esc(r.intended_use)},${esc(r.basis)},${esc(r.notifier)},${esc(r.filing_date)},${esc(r.closure_date)},${esc(r.fda_response)})`;
  }).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO fda_gras_notices (grn_number,substance,intended_use,basis,notifier,filing_date,closure_date,fda_response) VALUES ${values}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
    if (imported % 500 === 0 || i + BATCH_SIZE >= records.length) {
      console.log(`Imported ${imported}/${records.length}`);
    }
  } catch(e) {
    console.error(`Error batch ${i}: ${e.stderr?.toString().substring(0, 150)}`);
  }
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} GRAS notices imported.`);
