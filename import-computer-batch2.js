const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parse } = require('csv-parse/sync');

// ── Config ──────────────────────────────────────────────────────────────
const DB_NAME = 'benda-ingredients';
const BATCH_SIZE = 50;
const MAX_FIELD_LEN = 2000; // truncate fields longer than this
const BASE_DIR = 'C:\\BENDA_PROJECT\\ROOTS_BY_BENDA\\11_INBOX\\27.2.2';

const FILES = [
  {
    file: 'toxvaldb_cosmetics_food_additives_v97.csv',
    table: 'toxvaldb',
    columns: [
      'chemical_name','cas_number','dtxsid','toxicity_type','toxicity_type_original',
      'value','units','qualifier','species','study_type','exposure_route',
      'exposure_method','duration_class','duration_value','duration_units','sex',
      'strain','critical_effect','risk_assessment_class','human_eco','qc_status',
      'source_database','subsource','study_year','toxval_id','key_finding','record_type'
    ],
    maxField: 1000
  },
  {
    file: 'brazil_india_cosmetic_ingredients.csv',
    table: 'brazil_india_cosmetics',
    columns: [
      'ingredient_name','cas_number','restriction_type','max_concentration',
      'product_type_restrictions','jurisdiction','regulation_reference','notes'
    ],
    hasBom: true,
    maxField: 1000
  },
  {
    file: 'icsc_database.csv',
    table: 'icsc_chemicals',
    columns: null, // read from header
    maxField: 2000
  },
  {
    file: 'sccs_1628_21_exposure_parameters.csv',
    table: 'sccs_exposure_parameters',
    columns: [
      'source_table','population','product_category','product_type',
      'leave_on_or_rinse_off','estimated_daily_amount_g_per_day',
      'relative_daily_amount_mg_kg_bw_d','retention_factor',
      'calculated_daily_exposure_g_per_day',
      'calculated_relative_daily_exposure_mg_kg_bw_d',
      'skin_surface_area_cm2','frequency_of_application','body_areas',
      'default_body_weight_kg','default_dermal_absorption_percent',
      'default_oral_absorption_percent','sed_formula','mos_formula','notes'
    ],
    hasBom: true,
    maxField: 1000
  },
  {
    file: 'eu_clp_annex_vi_table_3_1.csv',
    table: 'eu_clp_annex_vi',
    columns: [
      'index_number','international_chemical_identification','ec_number','cas_number',
      'hazard_class_and_category_code','hazard_statement_code','pictogram_code',
      'signal_word_code','hazard_statement_code_labelling',
      'supplemental_hazard_statement_code','specific_concentration_limits_m_factors',
      'notes','atp_inserted','in_application_date'
    ],
    maxField: 1000
  },
  {
    file: 'niosh_pocket_guide.csv',
    table: 'niosh_pocket_guide',
    columns: [
      'chemical_name','cas_number','rtecs_number','formula','rel','pel','idlh',
      'physical_description','health_hazards','target_organs','symptoms','first_aid',
      'exposure_routes','synonyms','dot_id_guide','conversion','molecular_weight',
      'boiling_point','freezing_point','solubility','vapor_pressure','specific_gravity',
      'flash_point','incompatibilities_reactivities','cancer_site',
      'personal_protection_sanitation'
    ],
    maxField: 2000
  },
  {
    file: 'iarc_monographs_complete.csv',
    table: 'iarc_monographs',
    columns: [
      'agent_name','cas_number','iarc_group','volume','publication_year',
      'evaluation_year','type','additional_notes'
    ],
    maxField: 1000
  }
];

// ── Helpers ─────────────────────────────────────────────────────────────

function stripBom(str) {
  return str.replace(/^\uFEFF/, '');
}

function sanitizeColumnName(raw) {
  // lowercase, replace non-alphanum with underscore, collapse multiple underscores
  let col = raw.toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  // If empty after sanitize, give a generic name
  if (!col) col = 'col';
  return col;
}

function escapeSQL(val, maxLen) {
  if (val === null || val === undefined || val === '') return 'NULL';
  let s = String(val).trim();
  if (s === '') return 'NULL';
  // Strip \r
  s = s.replace(/\r/g, '');
  // Truncate
  if (s.length > maxLen) s = s.substring(0, maxLen);
  // Escape single quotes
  s = s.replace(/'/g, "''");
  return `'${s}'`;
}

function runSQL(sqlFile) {
  // Note: all inputs are internally generated (no user input), safe to use shell
  try {
    const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --file="${sqlFile}"`;
    const result = execSync(cmd, {
      cwd: 'C:\\BENDA_PROJECT\\chem-mcp-server',
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
      shell: true
    });
    return result;
  } catch (err) {
    console.error('SQL execution error:', err.message.substring(0, 200));
    if (err.stdout) console.error('STDOUT:', err.stdout.substring(0, 500));
    if (err.stderr) console.error('STDERR:', err.stderr.substring(0, 500));
    throw err;
  }
}

function writeTempSQL(sql) {
  const tmpFile = path.join('C:\\BENDA_PROJECT\\chem-mcp-server',
    `tmp_batch2_${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql, 'utf-8');
  return tmpFile;
}

function cleanupTemp(tmpFile) {
  try { fs.unlinkSync(tmpFile); } catch(e) {}
}

// ── Main Import ─────────────────────────────────────────────────────────

async function importFile(config) {
  const filePath = path.join(BASE_DIR, config.file);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Importing: ${config.file} → ${config.table}`);
  console.log(`${'='.repeat(60)}`);

  // Read file
  let raw = fs.readFileSync(filePath, 'utf-8');
  raw = stripBom(raw);
  // Normalize line endings
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Parse CSV
  const records = parse(raw, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });

  if (records.length < 2) {
    console.log('  WARNING: File has fewer than 2 rows, skipping.');
    return;
  }

  // Get columns from header
  const headerRow = records[0];
  let columns;
  if (config.columns) {
    columns = config.columns;
  } else {
    columns = headerRow.map(h => sanitizeColumnName(stripBom(h)));
  }
  const dataRows = records.slice(1);

  console.log(`  Columns (${columns.length}): ${columns.slice(0, 5).join(', ')}${columns.length > 5 ? '...' : ''}`);
  console.log(`  Data rows: ${dataRows.length}`);

  const maxField = config.maxField || MAX_FIELD_LEN;

  // 1. CREATE TABLE
  const colDefs = columns.map(c => `"${c}" TEXT`).join(',\n  ');
  const createSQL = `DROP TABLE IF EXISTS "${config.table}";\nCREATE TABLE IF NOT EXISTS "${config.table}" (\n  ${colDefs}\n);`;

  let tmpFile = writeTempSQL(createSQL);
  console.log(`  Creating table "${config.table}"...`);
  runSQL(tmpFile);
  cleanupTemp(tmpFile);
  console.log(`  Table created.`);

  // 2. INSERT in batches
  const colNames = columns.map(c => `"${c}"`).join(', ');
  let inserted = 0;

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    const values = batch.map(row => {
      const vals = columns.map((_, idx) => {
        const val = idx < row.length ? row[idx] : null;
        return escapeSQL(val, maxField);
      });
      return `(${vals.join(', ')})`;
    });

    const insertSQL = `INSERT INTO "${config.table}" (${colNames}) VALUES\n${values.join(',\n')};\n`;
    tmpFile = writeTempSQL(insertSQL);
    try {
      runSQL(tmpFile);
      inserted += batch.length;
    } catch(err) {
      console.error(`  ERROR at batch starting row ${i}. Trying row-by-row...`);
      // Fallback: insert one by one
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const vals = columns.map((_, idx) => {
          const val = idx < row.length ? row[idx] : null;
          return escapeSQL(val, maxField);
        });
        const singleSQL = `INSERT INTO "${config.table}" (${colNames}) VALUES (${vals.join(', ')});\n`;
        const tmpSingle = writeTempSQL(singleSQL);
        try {
          runSQL(tmpSingle);
          inserted++;
        } catch(e2) {
          console.error(`  SKIP row ${i + j}: ${e2.message.substring(0, 100)}`);
        }
        cleanupTemp(tmpSingle);
      }
    }
    cleanupTemp(tmpFile);

    if (inserted % 1000 === 0 && inserted > 0) {
      console.log(`  Progress: ${inserted} / ${dataRows.length} rows inserted`);
    }
  }

  console.log(`  Inserted: ${inserted} / ${dataRows.length} rows`);

  // 3. Verify count
  const countSQL = `SELECT COUNT(*) as cnt FROM "${config.table}";`;
  tmpFile = writeTempSQL(countSQL);
  const countResult = runSQL(tmpFile);
  cleanupTemp(tmpFile);
  // Parse count from output
  const match = countResult.match(/"cnt":\s*(\d+)/);
  const count = match ? match[1] : 'UNKNOWN';
  console.log(`  VERIFIED COUNT: ${count}`);
}

async function main() {
  console.log('============================================================');
  console.log('  BATCH 2 IMPORT — 7 CSV files into D1 (benda-ingredients)');
  console.log('============================================================');
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Max field length: ${MAX_FIELD_LEN}`);
  console.log(`  Start time: ${new Date().toISOString()}`);

  for (const config of FILES) {
    await importFile(config);
  }

  // Final summary — query all tables
  console.log('\n\n============================================================');
  console.log('  FINAL VERIFICATION — All Table Counts');
  console.log('============================================================');

  for (const config of FILES) {
    const sql = `SELECT COUNT(*) as cnt FROM "${config.table}";`;
    const tmpFile = writeTempSQL(sql);
    try {
      const result = runSQL(tmpFile);
      const match = result.match(/"cnt":\s*(\d+)/);
      const count = match ? match[1] : 'UNKNOWN';
      console.log(`  ${config.table}: ${count} rows`);
    } catch(e) {
      console.log(`  ${config.table}: ERROR — ${e.message.substring(0, 80)}`);
    }
    cleanupTemp(tmpFile);
  }

  console.log(`\n  End time: ${new Date().toISOString()}`);
  console.log('  DONE!');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
