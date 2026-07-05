require('dotenv').config();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_RERANK_URL = 'https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking';
const NVIDIA_RERANK_MODEL = 'nvidia/rerank-qa-mistral-4b';

/**
 * Reranks a list of passages for a given query using NVIDIA's reranking API.
 * Falls back to returning the original list if the API fails or is not configured.
 * 
 * @param {string} query - The search query.
 * @param {Array<{text: string, source: string, score: number}>} passages - The list of passages to rerank.
 * @param {number} limit - Maximum number of reranked passages to return.
 * @returns {Promise<Array<{text: string, source: string, score: number, rerankScore?: number}>>}
 */
async function rerankPassages(query, passages, limit = 3) {
    if (!passages || passages.length === 0) {
        return [];
    }

    if (!NVIDIA_API_KEY) {
        console.warn('[RERANK WARNING] NVIDIA_API_KEY is not set. Skipping rerank and returning raw vector search results.');
        return passages.slice(0, limit);
    }

    try {
        console.log(`[RERANK] Requesting NVIDIA rerank for ${passages.length} passages using ${NVIDIA_RERANK_MODEL}...`);
        
        const response = await fetch(NVIDIA_RERANK_URL, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${NVIDIA_API_KEY}`
            },
            body: JSON.stringify({
                model: NVIDIA_RERANK_MODEL,
                query: { text: query },
                passages: passages.map(p => ({ text: p.text })),
                truncate: 'END'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`NVIDIA Reranking API returned status ${response.status}: ${errText}`);
        }

        const resJson = await response.json();
        
        if (resJson.rankings && Array.isArray(resJson.rankings)) {
            // Map the rankings back to the original passages
            const reranked = resJson.rankings.map(rank => {
                const passage = passages[rank.index];
                return {
                    ...passage,
                    rerankScore: rank.logit
                };
            });

            // Sort by rerank score descending
            reranked.sort((a, b) => b.rerankScore - a.rerankScore);

            console.log(`[RERANK] Successfully reranked ${reranked.length} passages.`);
            return reranked.slice(0, limit);
        } else {
            throw new Error(`Invalid response structure from NVIDIA Reranking API: ${JSON.stringify(resJson)}`);
        }

    } catch (error) {
        console.warn('[RERANK WARNING] NVIDIA reranking failed. Falling back to raw vector search order. Error:', error.message);
        // Fallback: return the original passages in their original order
        return passages.slice(0, limit);
    }
}

module.exports = {
    rerankPassages
};
