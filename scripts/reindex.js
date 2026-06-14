/**
 * scripts/reindex.js
 * 
 * One-shot reindex script to re-embed all knowledge documents into Qdrant
 * using the new Gemini gemini-embedding-001 (3072-dim) embedding model.
 * 
 * Usage:
 *   npm run reindex
 * 
 * This will:
 *   1. Walk through all files in the knowledge/ directory recursively
 *   2. Also process knowledge.txt and lasak_data.json from the root
 *   3. Parse, chunk, embed (Gemini API), and upsert to Qdrant
 *   4. Log progress for each file
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { processFile } = require('./processor');
const { ensureCollection } = require('./qdrant');

const rootDir = path.resolve(__dirname, '..');
const knowledgeDir = path.join(rootDir, 'knowledge');

// Additional root-level files to index
const rootFiles = [];

/**
 * Recursively walks a directory and collects all file paths
 * that match known document formats.
 */
function collectFiles(dir) {
    const supported = new Set(['.txt', '.md', '.json', '.pdf']);
    const results = [];

    if (!fs.existsSync(dir)) {
        return results;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && supported.has(path.extname(entry.name).toLowerCase())) {
            const name = entry.name;
            if (name === 'consolidated_knowledge.json' || name === 'consolidated_knowledge.md') {
                console.log(`[REINDEX] Skipping consolidated file (avoiding duplication): ${fullPath}`);
                continue;
            }
            results.push(fullPath);
        }
    }
    return results;
}

async function main() {
    console.log('===========================================');
    console.log('  LASAK AI — Gemini Embedding Reindexer  ');
    console.log('  Model: gemini-embedding-001 (3072-dim)  ');
    console.log('===========================================\n');

    // Step 1: Ensure the Qdrant collection exists with 3072 dimensions
    console.log('[REINDEX] Ensuring Qdrant collection is ready...');
    await ensureCollection();
    console.log('[REINDEX] Qdrant collection verified.\n');

    // Step 2: Collect all files to process
    const knowledgeFiles = collectFiles(knowledgeDir);
    const extraFiles = rootFiles.filter(f => fs.existsSync(f));
    const allFiles = [...knowledgeFiles, ...extraFiles];

    if (allFiles.length === 0) {
        console.warn('[REINDEX] No files found to index. Check that knowledge/ directory has content.');
        return;
    }

    console.log(`[REINDEX] Found ${allFiles.length} file(s) to process:\n`);
    allFiles.forEach((f, i) => console.log(`  ${i + 1}. ${path.relative(rootDir, f)}`));
    console.log('');

    // Step 3: Process each file
    let totalChunks = 0;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < allFiles.length; i++) {
        const filePath = allFiles[i];
        const relPath = path.relative(rootDir, filePath);

        console.log(`\n[REINDEX] (${i + 1}/${allFiles.length}) Processing: ${relPath}`);
        console.log('[REINDEX] ' + '─'.repeat(50));

        try {
            const chunkCount = await processFile(filePath);
            totalChunks += chunkCount;
            successCount++;
            console.log(`[REINDEX] ✅ Done — ${chunkCount} chunks indexed from "${relPath}".`);
        } catch (err) {
            failCount++;
            console.error(`[REINDEX] ❌ Failed to process "${relPath}": ${err.message}`);
        }

        // Small delay between files to respect Gemini API rate limits
        if (i < allFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Step 4: Summary
    console.log('\n===========================================');
    console.log('          REINDEX COMPLETE SUMMARY         ');
    console.log('===========================================');
    console.log(`  Files processed : ${successCount} succeeded, ${failCount} failed`);
    console.log(`  Total chunks    : ${totalChunks}`);
    console.log(`  Qdrant collection: lasak_knowledge`);
    console.log(`  Embedding model : gemini-embedding-001 (3072-dim)`);
    console.log('===========================================\n');

    if (failCount > 0) {
        console.warn(`[REINDEX] ⚠️  ${failCount} file(s) failed — review errors above.`);
        process.exit(1);
    } else {
        console.log('[REINDEX] 🎉 All files indexed successfully!');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('[REINDEX FATAL]', err);
    process.exit(1);
});
