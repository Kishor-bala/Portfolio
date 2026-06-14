const fs = require('fs');
const path = require('path');
const { ensureCollection } = require('./qdrant');
const { processFile, regenerateStructuredKnowledge } = require('./processor');

const rootDir = path.resolve(__dirname, '..');
const knowledgeDir = path.join(rootDir, 'knowledge');

async function runConversion() {
    try {
        console.log('--- STARTING KNOWLEDGE BASE CONVERSION & VECTOR INDEXING ---');
        
        // 1. Ensure Qdrant collection is ready
        await ensureCollection();

        // 2. Read raw files from knowledge/ root (ignore folders and consolidated outputs)
        const files = fs.readdirSync(knowledgeDir);
        const filesToProcess = files.filter(file => {
            const filePath = path.join(knowledgeDir, file);
            const isFile = fs.statSync(filePath).isFile();
            const ext = path.extname(file).toLowerCase();
            const isTargetExt = ext === '.pdf' || ext === '.json' || ext === '.md';
            const isConsolidated = file === 'consolidated_knowledge.json' || file === 'consolidated_knowledge.md';
            return isFile && isTargetExt && !isConsolidated;
        });

        console.log(`Found ${filesToProcess.length} raw documents to process:`, filesToProcess);

        // 3. Process each file sequentially
        let totalChunks = 0;
        for (const file of filesToProcess) {
            const filePath = path.join(knowledgeDir, file);
            const chunkCount = await processFile(filePath);
            totalChunks += chunkCount;
        }
        console.log(`Indexed a total of ${totalChunks} chunks to QdrantDB.`);

        // 4. Regenerate structured directories and consolidated training files
        await regenerateStructuredKnowledge();

        console.log('--- KNOWLEDGE CONVERSION & INDEXING COMPLETED SUCCESSFULLY ---');
    } catch (err) {
        console.error('Conversion failed with error:', err);
    } finally {
        process.exit(0);
    }
}

runConversion();
