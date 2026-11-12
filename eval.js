// Evaluate keyword and semantic search results with MRR and Recall@10.
// Run from this directory with: node eval.js
const fs = require('fs');

// Parse one CSV row, including quoted fields and escaped double quotes.
function parseCsvRow(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  fields.push(field);
  return fields;
}

function loadTestSet(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line.length > 0);
  if (lines.length < 2) {
    throw new Error(`${path} must contain a header and at least one test query.`);
  }

  const header = parseCsvRow(lines[0]).map(value => value.trim());
  const queryColumn = header.indexOf('query');
  const idsColumn = header.indexOf('correct_post_ids');
  if (queryColumn === -1 || idsColumn === -1) {
    throw new Error(`${path} must have query and correct_post_ids columns.`);
  }

  return lines.slice(1).map((line, index) => {
    const columns = parseCsvRow(line);
    const query = (columns[queryColumn] || '').trim();
    const idsText = (columns[idsColumn] || '').trim();
    const correctIds = idsText.split(';').map(id => id.trim()).filter(Boolean).map(Number);
    if (!query || correctIds.length === 0 || correctIds.some(id => !Number.isFinite(id))) {
      throw new Error(`Invalid query or correct_post_ids on CSV row ${index + 2}.`);
    }
    return { query, correctIds };
  });
}

const testSet = loadTestSet('test-set.csv');
const results = JSON.parse(fs.readFileSync('search-results.json', 'utf8'));

// Return the 1-based rank of the first correct result, or null for a miss.
function rankOf(rankedIds, correctIds) {
  const correct = new Set(correctIds.map(String));
  const index = rankedIds.findIndex(id => correct.has(String(id)));
  return index === -1 ? null : index + 1;
}

// Return 1 / the rank of the first correct result, or 0 if not found.
function reciprocalRank(rankedIds, correctIds) {
  const rank = rankOf(rankedIds, correctIds);
  return rank === null ? 0 : 1 / rank;
}

const keywordRRs = [];
const semanticRRs = [];
let keywordHits = 0;
let semanticHits = 0;
const rows = [];

for (const { query, correctIds } of testSet) {
  const queryResults = results[query];
  if (!queryResults || !Array.isArray(queryResults.keyword) || !Array.isArray(queryResults.semantic)) {
    throw new Error(`Missing keyword or semantic results for query: ${query}`);
  }

  const keywordRank = rankOf(queryResults.keyword, correctIds);
  const semanticRank = rankOf(queryResults.semantic, correctIds);
  const keywordRR = reciprocalRank(queryResults.keyword, correctIds);
  const semanticRR = reciprocalRank(queryResults.semantic, correctIds);

  keywordRRs.push(keywordRR);
  semanticRRs.push(semanticRR);
  if (keywordRR > 0) keywordHits++;
  if (semanticRR > 0) semanticHits++;

  rows.push({ query, keywordRank, semanticRank });
}

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const keywordMRR = average(keywordRRs);
const semanticMRR = average(semanticRRs);
const keywordRecall = keywordHits / testSet.length;
const semanticRecall = semanticHits / testSet.length;
const displayRank = rank => rank === null ? 'miss' : String(rank);
const escapeCell = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

console.log('| Query | Keyword rank | Semantic rank |');
console.log('|---|---|---|');
for (const row of rows) {
  console.log(`| ${escapeCell(row.query)} | ${displayRank(row.keywordRank)} | ${displayRank(row.semanticRank)} |`);
}
console.log(`| **Summary** | **MRR ${keywordMRR.toFixed(2)} · Recall@10 ${keywordRecall.toFixed(2)}** | **MRR ${semanticMRR.toFixed(2)} · Recall@10 ${semanticRecall.toFixed(2)}** |`);
