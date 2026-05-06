/**
 * Fetch NIOSH Pocket Guide annotations from PubChem
 * Source ID 11941 = NIOSH, ~1,324 annotations
 * Rate limit: 4 req/sec
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fetchJSON(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Fetching NIOSH substance list from PubChem...');

  // Get all SIDs from NIOSH source
  const sidsRes = await fetchJSON('https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sourceall/The%20National%20Institute%20for%20Occupational%20Safety%20and%20Health%20(NIOSH)/sids/JSON');
  await sleep(300);

  if (!sidsRes?.InformationList?.Information) {
    console.error('Failed to get NIOSH SIDs');
    // Fallback: try getting CIDs directly via annotation heading
    console.log('Trying annotations approach...');

    // Get a list of CIDs that have NIOSH annotations
    // We'll use a different approach - search for compounds with NIOSH data
    const results = [];

    // Fetch NIOSH NPG compounds page by page using PUG-View
    // The NIOSH source has ~677 chemicals in the Pocket Guide
    // Let's get them via the deposited substance approach
    const subRes = await fetchJSON('https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sourceall/The%20National%20Institute%20for%20Occupational%20Safety%20and%20Health%20(NIOSH)/cids/JSON');
    await sleep(300);

    if (subRes?.InformationList?.Information) {
      const cids = [];
      for (const info of subRes.InformationList.Information) {
        if (info.CID) cids.push(...(Array.isArray(info.CID) ? info.CID : [info.CID]));
      }
      const uniqueCids = [...new Set(cids)];
      console.log(`Found ${uniqueCids.length} unique CIDs with NIOSH data`);

      // For each CID, get basic properties
      const BATCH = 100;
      for (let i = 0; i < uniqueCids.length; i += BATCH) {
        const batch = uniqueCids.slice(i, i + BATCH);
        const cidStr = batch.join(',');
        const propsRes = await fetchJSON(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cidStr}/property/IUPACName,MolecularFormula,MolecularWeight/JSON`);
        await sleep(300);

        if (propsRes?.PropertyTable?.Properties) {
          for (const p of propsRes.PropertyTable.Properties) {
            results.push({
              cid: p.CID,
              name: p.IUPACName || null,
              formula: p.MolecularFormula || null,
              weight: p.MolecularWeight || null,
            });
          }
        }
        if ((i + BATCH) % 500 === 0 || i + BATCH >= uniqueCids.length) {
          console.log(`Properties: ${Math.min(i + BATCH, uniqueCids.length)}/${uniqueCids.length}`);
        }
      }

      const outputFile = path.join(os.homedir(), 'niosh-data.json');
      fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
      console.log(`Saved ${results.length} NIOSH compounds to ${outputFile}`);
    } else {
      console.error('Both approaches failed');
    }
    return;
  }

  console.log(`Got ${sidsRes.InformationList.Information.length} NIOSH SIDs`);
}

main().catch(console.error);
