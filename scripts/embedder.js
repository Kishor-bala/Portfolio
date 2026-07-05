require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || (process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',')[0].trim() : undefined);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Primary NVIDIA Configuration
const NVIDIA_MODEL = 'nvidia/nv-embedqa-e5-v5';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/embeddings';

// Fallback Gemini Configuration
const GEMINI_MODEL = 'gemini-embedding-001';

// Dimensionality set to 1024 for NVIDIA nv-embedqa-e5-v5 compatibility
const EMBEDDING_DIM = 1024;

if (!NVIDIA_API_KEY) {
    console.warn('[EMBEDDER WARNING] NVIDIA_API_KEY is not set in environment variables. Will fallback to Gemini.');
}
if (!GEMINI_API_KEY) {
    console.error('[EMBEDDER ERROR] GEMINI_API_KEY is not set in environment variables.');
}

/**
 * Calls the NVIDIA Embedding API (or falls back to Gemini) to generate a vector for the given text.
 * @param {string} text - The text to embed.
 * @param {string} taskType - The task type hint.
 *   Use 'RETRIEVAL_DOCUMENT' when indexing (NVIDIA input_type: 'passage'),
 *   'RETRIEVAL_QUERY' when searching (NVIDIA input_type: 'query').
 * @returns {Promise<number[]>} 1024-dimensional float array
 */
async function getEmbedding(text, taskType = 'RETRIEVAL_QUERY') {
    try {
        // Clean text — replace multiple spaces/newlines
        const cleanText = text.replace(/\s+/g, ' ').trim();

        if (!cleanText) {
            console.warn('[EMBEDDER] Empty text received, returning zero vector.');
            return new Array(EMBEDDING_DIM).fill(0);
        }

        // --- NVIDIA (PRIMARY) ---
        if (NVIDIA_API_KEY) {
            try {
                const inputType = (taskType === 'RETRIEVAL_DOCUMENT') ? 'passage' : 'query';
                console.log(`[EMBEDDER] Attempting to generate embedding via NVIDIA (${inputType})...`);
                
                const response = await fetch(NVIDIA_URL, {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${NVIDIA_API_KEY}`
                    },
                    body: JSON.stringify({
                        input: [cleanText],
                        model: NVIDIA_MODEL,
                        input_type: inputType,
                        encoding_format: 'float'
                    })
                });

                if (response.ok) {
                    const resJson = await response.json();
                    if (resJson.data && resJson.data[0] && resJson.data[0].embedding) {
                        const vector = resJson.data[0].embedding;
                        console.log(`[EMBEDDER] Successfully generated ${vector.length}-dim embedding via NVIDIA.`);
                        return vector;
                    }
                } else {
                    const errText = await response.text();
                    console.warn(`[EMBEDDER WARNING] NVIDIA API returned status ${response.status}: ${errText}. Falling back to Gemini...`);
                }
            } catch (nvidiaErr) {
                console.warn('[EMBEDDER WARNING] NVIDIA embedding failed, falling back to Gemini. Error:', nvidiaErr.message);
            }
        }

        // --- GEMINI (FALLBACK) ---
        if (!GEMINI_API_KEY) {
            throw new Error('Both NVIDIA and Gemini API keys are missing or failed.');
        }

        console.log(`[EMBEDDER] Generating fallback embedding via Gemini (${taskType}, requested 1024 dims)...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

        const requestBody = {
            model: `models/${GEMINI_MODEL}`,
            content: {
                parts: [{ text: cleanText }]
            },
            taskType: taskType,
            outputDimensionality: EMBEDDING_DIM
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

        let vector = resJson.embedding.values;

        // Extra guard: if Gemini ignored the outputDimensionality parameter, truncate manually
        if (vector.length !== EMBEDDING_DIM) {
            console.warn(`[EMBEDDER] Gemini returned ${vector.length} dims instead of ${EMBEDDING_DIM}. Truncating and normalizing...`);
            vector = vector.slice(0, EMBEDDING_DIM);
            // L2 normalize
            const sumSq = vector.reduce((sum, val) => sum + val * val, 0);
            const norm = Math.sqrt(sumSq) || 1;
            vector = vector.map(val => val / norm);
        }

        console.log(`[EMBEDDER] Generated ${vector.length}-dim fallback embedding via Gemini.`);
        return vector;

    } catch (error) {
        console.error('[EMBEDDER ERROR] Embedding pipeline failed:', error.message);
        throw error;
    }
}

/**
 * Generates a document embedding (for indexing into Qdrant).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function getDocumentEmbedding(text) {
    return getEmbedding(text, 'RETRIEVAL_DOCUMENT');
}

/**
 * Generates a query embedding (for searching Qdrant).
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
