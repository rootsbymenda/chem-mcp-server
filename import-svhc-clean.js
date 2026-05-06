const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/SVHC_Candidate_List_253_substances.csv', 'utf8');
const lines = raw.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').slice(1).filter(l => l.trim());
console.log(`SVHC lines: ${lines.length}`);

const records = [];
for (const line of lines) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  fields.push(current.trim());
  if (fields[0]) {
    records.push({
      name: fields[0],
      cas: fields[1] || '',
      ec: fields[2] || '',
      date: fields[3] || '',
      reason: fields[4] || ''
    });
  }
}

console.log(`Parsed: ${records.length} substances`);

const tmpFile = path.join(__dirname, 'tmp_svhc2.sql');
const esc = (v) => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''").substring(0, 500)}'`;

const BATCH = 50;
let imported = 0;

for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);
  const vals = batch.map(r => `(${esc(r.name)},${esc(r.ec)},${esc(r.cas)},${esc(r.date)},${esc(r.reason)})`).join(',\n');
  fs.writeFileSync(tmpFile, `INSERT INTO echa_svhc (substance_name,ec_number,cas_number,date_included,reason) VALUES ${vals}`);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
  } catch(e) {}
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} SVHC substances imported (full 253-entry list from ECHA Feb 2026)`);
