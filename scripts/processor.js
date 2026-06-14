const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pdf = require('pdf-parse');
const { getDocumentEmbedding } = require('./embedder');
const { upsertPoints } = require('./qdrant');

// Paths
const rootDir = path.resolve(__dirname, '..');
const knowledgeDir = path.join(rootDir, 'knowledge');
const coursesDir = path.join(knowledgeDir, 'courses');
const facultyDir = path.join(knowledgeDir, 'faculty');
const policiesDir = path.join(knowledgeDir, 'policies');
const placementsDir = path.join(knowledgeDir, 'placements');
const faqDir = path.join(knowledgeDir, 'faq');
const lasakDataPath = path.join(rootDir, 'lasak_data.json');

// Ensure directories exist
function ensureDirs() {
    [coursesDir, facultyDir, policiesDir, placementsDir, faqDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

/**
 * Parses raw text from files based on extension.
 * @param {string} filePath 
 * @returns {Promise<string>}
 */
async function parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text;
    } else if (ext === '.json') {
        const raw = fs.readFileSync(filePath, 'utf8');
        try {
            const parsed = JSON.parse(raw);
            return JSON.stringify(parsed, null, 2);
        } catch (e) {
            return raw;
        }
    } else {
        return fs.readFileSync(filePath, 'utf8');
    }
}

/**
 * Splits text into chunks with sliding overlap.
 */
function chunkText(text, sourceFile, chunkSize = 1000, chunkOverlap = 200) {
    const chunks = [];
    const cleanText = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    let start = 0;
    while (start < cleanText.length) {
        let end = start + chunkSize;
        if (end >= cleanText.length) {
            chunks.push(cleanText.substring(start));
            break;
        }
        let splitIndex = cleanText.lastIndexOf('\n', end);
        if (splitIndex < start + chunkSize - 200) {
            splitIndex = cleanText.lastIndexOf(' ', end);
        }
        if (splitIndex > start) {
            end = splitIndex;
        }
        chunks.push(cleanText.substring(start, end).trim());
        start = end - chunkOverlap;
        if (start < 0) start = 0;
    }
    return chunks
        .map(c => c.trim())
        .filter(c => c.length > 50);
}

/**
 * Formats a 32-char hex string as standard UUID.
 */
function hexToUUID(hex) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Processes a single file: parses, chunks, generates embeddings, and indexes into Qdrant.
 */
async function processFile(filePath) {
    try {
        console.log(`[PROCESS] Processing file: ${filePath}`);
        const fileName = path.basename(filePath);
        const text = await parseFile(filePath);
        
        const chunks = chunkText(text, fileName);
        console.log(`[PROCESS] Split "${fileName}" into ${chunks.length} chunks.`);

        const points = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const cleanText = chunk.replace(/\s+/g, ' ').trim();
            
            // Generate deterministic UUID based on chunk content and filename
            const hash = crypto.createHash('md5').update(chunk + fileName).digest('hex');
            const id = hexToUUID(hash);
            
            console.log(`[PROCESS] Generating Gemini embedding for chunk ${i+1}/${chunks.length}...`);
            const vector = await getDocumentEmbedding(cleanText);

            points.push({
                id,
                vector,
                payload: {
                    text: chunk,
                    source: fileName,
                    chunk_index: i,
                    timestamp: new Date().toISOString()
                }
            });
        }

        // Upsert to Qdrant
        if (points.length > 0) {
            await upsertPoints(points);
        }
        return chunks.length;
    } catch (error) {
        console.error(`[PROCESS ERROR] Failed to process ${filePath}:`, error);
        throw error;
    }
}

/**
 * Compiles all knowledge bases (both raw extracts and structured inputs),
 * generates individual structured files under subdirectories,
 * and compiles consolidated files.
 */
async function regenerateStructuredKnowledge() {
    ensureDirs();
    console.log('[STRUCTURE] Regenerating consolidated knowledge files from knowledge folder...');

    try {
        const files = fs.readdirSync(knowledgeDir);
        let consolidatedMd = `# Consolidated Portfolio & Knowledge Base\n\n`;

        for (const file of files) {
            const filePath = path.join(knowledgeDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                const ext = path.extname(file).toLowerCase();
                const base = path.basename(file).toLowerCase();
                // Merge all text and markdown files except the consolidated files themselves
                if ((ext === '.md' || ext === '.txt') && 
                    base !== 'consolidated_knowledge.md' && 
                    base !== 'consolidated_knowledge.json') {
                    
                    const content = fs.readFileSync(filePath, 'utf8');
                    consolidatedMd += `\n---\n\n## Source File: ${file}\n\n${content}\n`;
                }
            }
        }

        // Also write a consolidated JSON version to maintain backward compatibility
        const consolidatedJson = {
            description: "Consolidated Portfolio and Profile data",
            timestamp: new Date().toISOString(),
            raw_markdown: consolidatedMd
        };

        fs.writeFileSync(path.join(knowledgeDir, 'consolidated_knowledge.md'), consolidatedMd, 'utf8');
        fs.writeFileSync(path.join(knowledgeDir, 'consolidated_knowledge.json'), JSON.stringify(consolidatedJson, null, 2), 'utf8');
        
        // Overwrite root lasak_data.json just in case there are dependencies or checks
        fs.writeFileSync(lasakDataPath, JSON.stringify(consolidatedJson, null, 2), 'utf8');
        
        console.log('[STRUCTURE] Dynamic consolidation completed successfully.');
    } catch (err) {
        console.error('[STRUCTURE ERROR] Failed to regenerate consolidated knowledge base:', err.message);
    }
}

module.exports = {
    parseFile,
    chunkText,
    processFile,
    regenerateStructuredKnowledge
};
