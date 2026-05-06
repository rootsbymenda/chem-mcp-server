const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'C:/BENDA_PROJECT/ROOTS_BY_BENDA/11_INBOX/27.2.2';
const tmpFile = path.join(__dirname, 'tmp_imp.sql');

function esc(v) {
  if (v == null || v === '' || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''").substring(0, 500)}'`;
}

function runSQL(sql) {
  fs.writeFileSync(tmpFile, sql, 'utf8');
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'benda-ingredients', '--remote', `--file=${tmpFile}`, '--yes'], {
      cwd: __dirname, timeout: 30000, stdio: 'pipe', shell: true
    });
    return true;
  } catch(e) { return false; }
}

function parseCSV(filePath, skipBOM) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (skipBOM) raw = raw.replace(/^\uFEFF/, '');
  const lines = raw.replace(/\r/g, '').split('\n');
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(parseCSVLine(lines[i]));
  }
  return { header, rows };
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ',' && !inQ) { fields.push(current.trim()); current = ''; }
    else current += line[i];
  }
  fields.push(current.trim());
  return fields;
}

function importCSV(file, table, createSQL, colCount, colNames, label) {
  console.log(`\n=== ${label} ===`);
  runSQL(createSQL);
  const { rows } = parseCSV(path.join(BASE, file), true);
  console.log(`Parsed: ${rows.length} rows`);

  const BATCH = 50;
  let imported = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vals = batch.map(r => {
      const cols = [];
      for (let j = 0; j < colCount; j++) cols.push(esc(r[j]));
      return `(${cols.join(',')})`;
    }).join(',\n');

    if (runSQL(`INSERT INTO ${table} (${colNames}) VALUES ${vals}`)) {
      imported += batch.length;
    }
    if (imported % 2000 === 0 || i + BATCH >= rows.length) console.log(`  ${imported}/${rows.length}`);
  }
  console.log(`  DONE: ${imported} imported`);
  return imported;
}

let total = 0;

// 1. Codex GSFA
total += importCSV('gsfa_codex_provisions_complete.csv', 'codex_gsfa',
  "CREATE TABLE IF NOT EXISTS codex_gsfa (id INTEGER PRIMARY KEY AUTOINCREMENT, ins TEXT, name TEXT, functional_class TEXT, food_category_code TEXT, food_category_name TEXT, max_level TEXT, notes TEXT)",
  7, 'ins,name,functional_class,food_category_code,food_category_name,max_level,notes', 'Codex GSFA (11,143)');

// 2. WHO Essential Medicines
total += importCSV('WHO_EML_24th_2025_Complete.csv', 'who_essential_medicines',
  "CREATE TABLE IF NOT EXISTS who_essential_medicines (id INTEGER PRIMARY KEY AUTOINCREMENT, medicine_name TEXT, atc_code TEXT, eml_section TEXT, list_type TEXT, formulations TEXT, indication TEXT)",
  6, 'medicine_name,atc_code,eml_section,list_type,formulations,indication', 'WHO Essential Medicines (1,470)');

// 3. IFRA Standards
total += importCSV('ifra_standards_complete.csv', 'ifra_standards',
  "CREATE TABLE IF NOT EXISTS ifra_standards (id INTEGER PRIMARY KEY AUTOINCREMENT, std_number TEXT, ifra_name TEXT, cas_numbers TEXT, recommendation_type TEXT, amendment TEXT, publication_date TEXT)",
  6, 'std_number,ifra_name,cas_numbers,recommendation_type,amendment,publication_date', 'IFRA Standards (267)');

// 4. Banned Cosmetics Cross-Reference
total += importCSV('banned_cosmetic_ingredients_crossref.csv', 'banned_cosmetics_crossref',
  "CREATE TABLE IF NOT EXISTS banned_cosmetics_crossref (id INTEGER PRIMARY KEY AUTOINCREMENT, substance_name TEXT, cas_number TEXT, eu_annex_ii TEXT, usa_fda TEXT, canada_hotlist TEXT, japan_mhlw TEXT, korea_mfds TEXT, asean TEXT, australia TEXT, jurisdictions_count TEXT)",
  10, 'substance_name,cas_number,eu_annex_ii,usa_fda,canada_hotlist,japan_mhlw,korea_mfds,asean,australia,jurisdictions_count', 'Banned Cosmetics Cross-Reference (2,342)');

// 5. ATSDR MRL
total += importCSV('ATSDR_MRL_Complete.csv', 'atsdr_mrl',
  "CREATE TABLE IF NOT EXISTS atsdr_mrl (id INTEGER PRIMARY KEY AUTOINCREMENT, chemical_name TEXT, cas_number TEXT, route TEXT, duration TEXT, mrl_value TEXT, units TEXT, critical_effect TEXT, uncertainty_factors TEXT, status TEXT, year TEXT)",
  10, 'chemical_name,cas_number,route,duration,mrl_value,units,critical_effect,uncertainty_factors,status,year', 'ATSDR MRL (485)');

// 6. EU FCM Substances
total += importCSV('eu_fcm_authorized_substances_complete.csv', 'eu_fcm_substances',
  "CREATE TABLE IF NOT EXISTS eu_fcm_substances (id INTEGER PRIMARY KEY AUTOINCREMENT, fcm_no TEXT, ref_no TEXT, cas_no TEXT, substance_name TEXT, material_type TEXT, regulation TEXT, use_additive TEXT, use_monomer TEXT, frf TEXT, sml TEXT)",
  10, 'fcm_no,ref_no,cas_no,substance_name,material_type,regulation,use_additive,use_monomer,frf,sml', 'EU FCM Substances (955)');

// 7. EU FCM Group Restrictions
total += importCSV('eu_fcm_group_restrictions.csv', 'eu_fcm_group_restrictions',
  "CREATE TABLE IF NOT EXISTS eu_fcm_group_restrictions (id INTEGER PRIMARY KEY AUTOINCREMENT, group_no TEXT, fcm_nos TEXT, sml_t TEXT, specification TEXT)",
  4, 'group_no,fcm_nos,sml_t,specification', 'EU FCM Group Restrictions (38)');

// 8. EU FCM Compliance Notes
total += importCSV('eu_fcm_compliance_notes.csv', 'eu_fcm_compliance_notes',
  "CREATE TABLE IF NOT EXISTS eu_fcm_compliance_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, note_no TEXT, note_text TEXT)",
  2, 'note_no,note_text', 'EU FCM Compliance Notes (30)');

// 9. ChEMBL Bioactivity
total += importCSV('chembl_bioactivity_clean.csv', 'chembl_bioactivity',
  "CREATE TABLE IF NOT EXISTS chembl_bioactivity (id INTEGER PRIMARY KEY AUTOINCREMENT, compound_name TEXT, category TEXT, chembl_id TEXT, cas_number TEXT, target_name TEXT, target_organism TEXT, activity_type TEXT, activity_value TEXT, activity_units TEXT, pchembl_value TEXT)",
  10, 'compound_name,category,chembl_id,cas_number,target_name,target_organism,activity_type,activity_value,activity_units,pchembl_value', 'ChEMBL Bioactivity (7,941)');

// 10. California Prop 65
total += importCSV('california_prop65_complete.csv', 'california_prop65',
  "CREATE TABLE IF NOT EXISTS california_prop65 (id INTEGER PRIMARY KEY AUTOINCREMENT, chemical_name TEXT, cas_number TEXT, toxicity_type TEXT, cancer TEXT, developmental TEXT, male_repro TEXT, female_repro TEXT, listing_mechanism TEXT, listed_date TEXT, nsrl TEXT, madl TEXT)",
  11, 'chemical_name,cas_number,toxicity_type,cancer,developmental,male_repro,female_repro,listing_mechanism,listed_date,nsrl,madl', 'California Prop 65 (1,011)');

// 11. Health Canada Food Additives
total += importCSV('health_canada_permitted_food_additives.csv', 'health_canada_food_additives',
  "CREATE TABLE IF NOT EXISTS health_canada_food_additives (id INTEGER PRIMARY KEY AUTOINCREMENT, substance_name TEXT, functional_class TEXT, permitted_foods TEXT, maximum_level TEXT, list_name TEXT)",
  5, 'substance_name,functional_class,permitted_foods,maximum_level,list_name', 'Health Canada Food Additives (2,899)');

// 12. FDA GRAS Enriched
total += importCSV('fda_gras_notices_complete_enriched.csv', 'fda_gras_enriched',
  "CREATE TABLE IF NOT EXISTS fda_gras_enriched (id INTEGER PRIMARY KEY AUTOINCREMENT, grn_number TEXT, substance TEXT, cas_number TEXT, intended_use TEXT, notifier TEXT, filing_date TEXT, closure_date TEXT, fda_response TEXT, basis TEXT, notifier_address TEXT)",
  10, 'grn_number,substance,cas_number,intended_use,notifier,filing_date,closure_date,fda_response,basis,notifier_address', 'FDA GRAS Enriched (1,290)');

// 13. DrugBank
total += importCSV('drugbank_approved_drugs.csv', 'drugbank_drugs',
  "CREATE TABLE IF NOT EXISTS drugbank_drugs (id INTEGER PRIMARY KEY AUTOINCREMENT, drugbank_id TEXT, drug_name TEXT, cas_number TEXT, drug_groups TEXT, smiles TEXT, targets TEXT, ddi_count TEXT)",
  7, 'drugbank_id,drug_name,cas_number,drug_groups,smiles,targets,ddi_count', 'DrugBank Drugs (4,947)');

try { fs.unlinkSync(tmpFile); } catch(e) {}
console.log(`\n=== ALL DONE === Total: ${total} records imported across 13 tables`);
