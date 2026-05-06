const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync('C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2/gestis_oel_all_substances.csv', 'utf8');
const lines = raw.replace(/\r/g, '').split('\n').slice(1).filter(l => l.trim());
console.log(`GESTIS lines: ${lines.length}`);

const tmpFile = path.join(__dirname, 'tmp_gestis.sql');
const esc = (v) => !v || v.trim() === '' ? 'NULL' : `'${v.trim().replace(/'/g, "''").substring(0, 300)}'`;

function parseLine(line) {
  const fields = [];
  let current = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ',' && !inQ) { fields.push(current); current = ''; }
    else current += line[i];
  }
  fields.push(current);
  return fields;
}

const BATCH = 50;
let imported = 0;

for (let i = 0; i < lines.length; i += BATCH) {
  const batch = lines.slice(i, i + BATCH);
  const vals = batch.map(line => {
    const f = parseLine(line);
    return `(${esc(f[0])},${esc(f[1])},${esc(f[3])},${esc(f[6])},${esc(f[9])},${esc(f[12])},${esc(f[15])},${esc(f[18])},${esc(f[20])})`;
  }).join(',\n');

  fs.writeFileSync(tmpFile, `INSERT INTO gestis_oel (substance_name,cas_number,usa_osha_twa,usa_niosh_twa,germany_ags_twa,uk_wel_twa,eu_ioelv_twa,israel_twa,countries_with_data) VALUES ${vals}`);

  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    imported += batch.length;
  } catch(e) {}

  if (imported % 500 === 0 || i + BATCH >= lines.length) console.log(`${imported}/${lines.length}`);
}

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`Done! ${imported} GESTIS OEL records imported.`);
