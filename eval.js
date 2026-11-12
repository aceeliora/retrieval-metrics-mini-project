// Evaluate the provided keyword and semantic retrieval results with MRR and Recall@10.
// Run from any directory with: node /path/to/retrieval-metrics-mini-project/eval.js
const fs = require('fs');
const path = require('path');

const TOP_K = 10;

// Parse CSV rows while supporting quoted fields, escaped quotes, and commas in queries.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error('Invalid CSV: unterminated quoted field.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some(value => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function loadTestSet(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (rows.length < 2) throw new Error('The test set must contain a header and at least one query.');

  const headers = rows[0].map(value => value.trim());
  const queryIndex = headers.indexOf('query');
  const idsIndex = headers.indexOf('correct_post_ids');
  if (queryIndex === -1 || idsIndex === -1) {
    throw new Error('Expected CSV headers: query,correct_post_ids.');
  }

  return rows.slice(1).map((values, index) => {
    const query = values[queryIndex]?.trim();
    const rawIds = values[idsIndex]?.trim();
    if (!query || !rawIds) throw new Error(`Missing query or correct IDs on CSV row ${index + 2}.`);

    const correctIds = rawIds.split(';').map(value => Number(value.trim()));
    if (correctIds.some(id => !Number.isInteger(id))) {
      throw new Error(`Invalid correct post ID on CSV row ${index + 2}.`);
    }
    return { query, correctIds };
  });
}

function readSearchResults(filePath) {
  const results = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    throw new Error('Search results must be a JSON object keyed by query.');
  }
  return results;
}

const testSet = loadTestSet(path.join(__dirname, 'test-set.csv'));
const results = readSearchResults(path.join(__dirname, 'search-results.json'));

// Return the 1-based rank of the first correct result in the top 10, or null on a miss.
function rankOf(rankedIds, correctIds) {
  if (!Array.isArray(rankedIds)) throw new Error('Each system must provide an array of ranked post IDs.');
  const correct = new Set(correctIds.map(String));
  const index = rankedIds.slice(0, TOP_K).findIndex(id => correct.has(String(id)));
  return index === -1 ? null : index + 1;
}

// Reciprocal Rank is zero when none of the correct answers appears in the top 10.
function reciprocalRank(rankedIds, correctIds) {
  const rank = rankOf(rankedIds, correctIds);
  return rank === null ? 0 : 1 / rank;
}

const systems = {
  keyword: { reciprocalRanks: [], hits: 0 },
  semantic: { reciprocalRanks: [], hits: 0 },
};
const rows = [];

for (const { query, correctIds } of testSet) {
  const queryResults = results[query];
  if (!queryResults) throw new Error(`No search results found for query: ${query}`);

  const keywordRank = rankOf(queryResults.keyword, correctIds);
  const semanticRank = rankOf(queryResults.semantic, correctIds);
  systems.keyword.reciprocalRanks.push(reciprocalRank(queryResults.keyword, correctIds));
  systems.semantic.reciprocalRanks.push(reciprocalRank(queryResults.semantic, correctIds));
  if (keywordRank !== null) systems.keyword.hits++;
  if (semanticRank !== null) systems.semantic.hits++;

  rows.push({ query, keywordRank, semanticRank });
}

function summarize(system) {
  const mrr = system.reciprocalRanks.reduce((total, score) => total + score, 0) / testSet.length;
  const recall = system.hits / testSet.length;
  return { mrr, recall };
}

const keywordSummary = summarize(systems.keyword);
const semanticSummary = summarize(systems.semantic);
const displayRank = rank => rank === null ? 'miss' : String(rank);
const displayCell = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

console.log('| Query | Keyword rank | Semantic rank |');
console.log('|---|---|---|');
for (const row of rows) {
  console.log(`| ${displayCell(row.query)} | ${displayRank(row.keywordRank)} | ${displayRank(row.semanticRank)} |`);
}
console.log(
  `| **Summary** | **MRR ${keywordSummary.mrr.toFixed(2)} · Recall@10 ${keywordSummary.recall.toFixed(2)}** | **MRR ${semanticSummary.mrr.toFixed(2)} · Recall@10 ${semanticSummary.recall.toFixed(2)}** |`,
);
