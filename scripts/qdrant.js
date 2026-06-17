const { QdrantClient } = require('@qdrant/js-client-rest');
require('dotenv').config();

// Patch for Node.js v26+ compatibility with the custom undici dispatcher used by the qdrant client library
if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function(url, init) {
        if (init && init.dispatcher) {
            delete init.dispatcher;
        }
        return originalFetch(url, init);
    };
}

const QDRANT_URL = process.env.QDRANT_URL || 'https://677dc875-eec2-41c1-9cd6-f70a293b23e8.eu-west-1-0.aws.cloud.qdrant.io';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'lasak_knowledge';

let client = null;

function getQdrantClient() {
    if (!client) {
        client = new QdrantClient({
            url: QDRANT_URL,
            apiKey: QDRANT_API_KEY,
            checkCompatibility: false
        });
    }
    return client;
}

/**
 * Ensures the Qdrant collection exists and is configured for Gemini gemini-embedding-001 (3072 dimensions).
 */
async function ensureCollection() {
    const qClient = getQdrantClient();
    try {
        console.log(`Checking Qdrant collection: "${COLLECTION_NAME}"...`);
        const response = await qClient.getCollections();
        const exists = response.collections.some(c => c.name === COLLECTION_NAME);

        if (!exists) {
            console.log(`Collection "${COLLECTION_NAME}" does not exist. Creating it now...`);
            await qClient.createCollection(COLLECTION_NAME, {
                vectors: {
                    size: 3072, // Gemini gemini-embedding-001 dimension
                    distance: 'Cosine'
                }
            });
            console.log(`Collection "${COLLECTION_NAME}" created successfully.`);
        } else {
            console.log(`Collection "${COLLECTION_NAME}" already exists. Verifying parameters...`);
            try {
                const info = await qClient.getCollection(COLLECTION_NAME);
                console.log("[QDRANT DEBUG] Collection info:", JSON.stringify(info, null, 2));
                
                const vectors = info.config && info.config.params ? info.config.params.vectors : null;
                const isUnnamedVector = vectors && typeof vectors.size === 'number';
                const currentSize = isUnnamedVector ? vectors.size : null;
                
                if (!isUnnamedVector || currentSize !== 3072) {
                    console.log(`[QDRANT WARNING] Collection "${COLLECTION_NAME}" does not have a single unnamed vector of size 3072 (isUnnamedVector: ${isUnnamedVector}, size: ${currentSize}). Recreating it...`);
                    await qClient.deleteCollection(COLLECTION_NAME);
                    await qClient.createCollection(COLLECTION_NAME, {
                        vectors: {
                            size: 3072,
                            distance: 'Cosine'
                        }
                    });
                    console.log(`Collection "${COLLECTION_NAME}" recreated successfully with a single unnamed 3072-dimensional vector.`);
                } else {
                    console.log(`Collection "${COLLECTION_NAME}" verified successfully with correct single unnamed vector size (3072).`);
                }
            } catch (checkErr) {
                console.warn(`[QDRANT WARNING] Could not verify collection parameters: ${checkErr.message}. Proceeding...`);
            }
        }

        // Ensure payload index is created on "source" key for efficient filtering and deletion
        try {
            await qClient.createPayloadIndex(COLLECTION_NAME, {
                field_name: "source",
                field_schema: "keyword"
            });
        } catch (idxErr) {
            // Silence if already exists or schema mismatch
        }
    } catch (error) {
        console.warn(`[QDRANT OFFLINE] Failed to ensure Qdrant collection: ${error.message}. Semantic search indexing will be skipped.`);
    }
}

/**
 * Upserts an array of points into the Qdrant collection.
 * @param {Array<{id: string, vector: number[], payload: object}>} points 
 */
async function upsertPoints(points) {
    const qClient = getQdrantClient();
    try {
        await ensureCollection();
        console.log(`Upserting ${points.length} points to Qdrant collection "${COLLECTION_NAME}"...`);
        await qClient.upsert(COLLECTION_NAME, {
            wait: true,
            points: points
        });
        console.log('Points upserted successfully.');
    } catch (error) {
        console.error('[QDRANT ERROR DETAILED]', error);
        console.warn(`[QDRANT OFFLINE] Error upserting points to Qdrant: ${error.message}. Skipping vector indexing.`);
    }
}

/**
 * Search Qdrant for similar vectors.
 * @param {number[]} vector 
 * @param {number} limit 
 * @returns {Promise<Array<{score: number, payload: object}>>}
 */
async function searchVector(vector, limit = 5) {
    const qClient = getQdrantClient();
    try {
        const response = await qClient.search(COLLECTION_NAME, {
            vector: vector,
            limit: limit,
            with_payload: true,
            score_threshold: 0.3
        });
        return response;
    } catch (error) {
        console.error('[QDRANT SEARCH ERROR DETAILED]', error);
        console.warn(`[QDRANT OFFLINE] Error searching vector in Qdrant: ${error.message}. Returning empty results.`);
        return [];
    }
}

async function deletePointsBySource(fileName) {
    const qClient = getQdrantClient();
    try {
        await ensureCollection();
        console.log(`Deleting points for source "${fileName}" from Qdrant...`);
        await qClient.delete(COLLECTION_NAME, {
            wait: true,
            filter: {
                must: [
                    {
                        key: "source",
                        match: {
                            value: fileName
                        }
                    }
                ]
            }
        });
        console.log(`Points for source "${fileName}" deleted successfully.`);
    } catch (error) {
        console.error(`[QDRANT ERROR] Error deleting points for source "${fileName}" from Qdrant:`, error);
    }
}

module.exports = {
    ensureCollection,
    upsertPoints,
    searchVector,
    deletePointsBySource
};
