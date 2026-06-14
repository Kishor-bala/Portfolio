require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || (process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',')[0].trim() : undefined);

// Gemini embedding model: gemini-embedding-001
// Output: 3072 dimensions (default, using Matryoshka Representation Learning)
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM = 3072;

if (!GEMINI_API_KEY) {
    console.error('[EMBEDDER ERROR] GEMINI_API_KEY is not set in environment variables.');
}

/**
 * Calls the Gemini Embedding REST API to generate a vector for the given text.
 * @param {string} text - The text to embed.
 * @param {string} taskType - The task type hint for the model (improves quality).
 *   Use 'RETRIEVAL_DOCUMENT' when indexing, 'RETRIEVAL_QUERY' when searching.
 * @returns {Promise<number[]>} 3072-dimensional float array
 */
async function getEmbedding(text, taskType = 'RETRIEVAL_QUERY') {
    try {
        // Clean text — replace multiple spaces/newlines
        const cleanText = text.replace(/\s+/g, ' ').trim();

        if (!cleanText) {
            console.warn('[EMBEDDER] Empty text received, returning zero vector.');
            return new Array(EMBEDDING_DIM).fill(0);
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

        const requestBody = {
            model: `models/${EMBEDDING_MODEL}`,
            content: {
                parts: [{ text: cleanText }]
            },
            taskType: taskType
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini Embedding API returned status ${response.status}: ${errText}`);
        }

        const resJson = await response.json();

        if (!resJson.embedding || !resJson.embedding.values) {
            throw new Error(`Invalid response structure from Gemini Embedding API: ${JSON.stringify(resJson)}`);
        }

        const vector = resJson.embedding.values;
        console.log(`[EMBEDDER] Generated ${vector.length}-dim embedding via ${EMBEDDING_MODEL}.`);
        return vector;

    } catch (error) {
        console.error(`[EMBEDDER ERROR] Failed to generate embedding with ${EMBEDDING_MODEL}:`, error.message);
        throw error;
    }
}

/**
 * Generates a document embedding (for indexing into Qdrant).
 * Uses RETRIEVAL_DOCUMENT task type to optimize for storage & recall.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function getDocumentEmbedding(text) {
    return getEmbedding(text, 'RETRIEVAL_DOCUMENT');
}

/**
 * Generates a query embedding (for searching Qdrant).
 * Uses RETRIEVAL_QUERY task type to optimize for search relevance.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function getQueryEmbedding(text) {
    return getEmbedding(text, 'RETRIEVAL_QUERY');
}

module.exports = {
    getEmbedding,
    getDocumentEmbedding,
    getQueryEmbedding,
    EMBEDDING_DIM
};
