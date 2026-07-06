/**
 * scripts/cache.js
 *
 * Redis-backed response cache for the LASAK AI chatbot.
 * Reduces Gemini API costs by storing and replaying answers to
 * frequently asked questions.
 *
 * Design:
 *  - Cache key  : SHA-256 hash of normalized question text
 *  - Cache store: Redis string (JSON payload) with TTL
 *  - FAQ tracker: Redis sorted set (score = hit count) for analytics
 *  - TTL default: 24 hours (configurable via CACHE_TTL_SECONDS env)
 *
 * Cache is ONLY used for standalone questions (empty history).
 * Follow-up questions in a conversation are never cached because
 * their answer depends on prior context.
 */

const crypto = require('crypto');
require('dotenv').config();

// ─── Config ──────────────────────────────────────────────────────────────────
const CACHE_TTL_SECONDS    = parseInt(process.env.CACHE_TTL_SECONDS    || '86400'); // 24h
const REDIS_MAX_MEMORY_MB  = parseInt(process.env.REDIS_MAX_MEMORY_MB  || '30');   // your plan limit
const MAX_REPLY_BYTES      = 8000;   // ~8KB cap per cached reply (prevents huge entries)
const CACHE_KEY_PREFIX     = 'lasak:chat:cache:';
const FAQ_ZSET_KEY         = 'lasak:faq:hits';      // sorted set: hash → hit count
const FAQ_TEXT_PREFIX      = 'lasak:faq:text:';     // hash → original question text
const MAX_FAQ_ENTRIES      = 100;                   // ~300KB max for all FAQ entries @ 3KB each

// ─── Redis client (lazy singleton via queue.js connection) ────────────────────
let redisClient = null;

function getRedisClient() {
    if (!redisClient) {
        // Re-use the existing ioredis connection from queue.js
        const { getRedisConnection } = require('./queue');
        redisClient = getRedisConnection();
    }
    return redisClient;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalizes a question string for consistent cache key generation.
 * Strips punctuation, lowercases, and collapses whitespace.
 */
function normalizeQuestion(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')   // remove punctuation
        .replace(/\s+/g, ' ')      // collapse whitespace
        .trim();
}

/**
 * Generates a SHA-256 cache key from the normalized question.
 * Returns a short 16-char hex prefix for readability in Redis.
 */
function buildCacheKey(question) {
    const normalized = normalizeQuestion(question);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return `${CACHE_KEY_PREFIX}${hash}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attempts to retrieve a cached response for a question.
 *
 * @param {string} question - The raw user question.
 * @returns {Promise<{reply: string, cachedAt: string} | null>}
 *   The cached payload if found, or null on miss/error.
 */
async function getCachedResponse(question) {
    try {
        const client = getRedisClient();
        const key = buildCacheKey(question);
        const raw = await client.get(key);

        if (!raw) {
            return null; // cache miss
        }

        const payload = JSON.parse(raw);

        // Record a cache hit in the FAQ sorted set
        await recordFaqHit(question, key);

        console.log(`[CACHE HIT] "${question.substring(0, 60)}..." → key: ${key.slice(-8)}`);
        return payload;

    } catch (err) {
        // Never let cache errors crash the chat endpoint
        console.warn('[CACHE WARNING] getCachedResponse failed:', err.message);
        return null;
    }
}

/**
 * Stores a chat response in Redis with TTL.
 *
 * @param {string} question - The raw user question.
 * @param {string} reply    - The LLM-generated reply text.
 * @returns {Promise<void>}
 */
async function setCachedResponse(question, reply) {
    try {
        const client = getRedisClient();
        const key = buildCacheKey(question);

        // Guard: truncate extremely long replies to stay memory-efficient
        const safeReply = Buffer.byteLength(reply, 'utf8') > MAX_REPLY_BYTES
            ? reply.substring(0, MAX_REPLY_BYTES) + '\n\n*(response truncated in cache)*'
            : reply;

        const payload = JSON.stringify({
            reply: safeReply,
            question,
            cachedAt: new Date().toISOString()
        });

        // Store with TTL (EX = seconds)
        await client.set(key, payload, 'EX', CACHE_TTL_SECONDS);

        // Register this question in the FAQ tracker (score starts at 0)
        await recordFaqHit(question, key, false); // false = don't increment yet

        const sizeKB = (Buffer.byteLength(payload, 'utf8') / 1024).toFixed(1);
        console.log(`[CACHE SET] Stored ${sizeKB}KB for "${question.substring(0, 60)}..." TTL: ${CACHE_TTL_SECONDS}s`);

    } catch (err) {
        console.warn('[CACHE WARNING] setCachedResponse failed:', err.message);
    }
}

/**
 * Increments the hit counter for a question in the FAQ sorted set.
 * Also stores the original question text for display in stats.
 *
 * @param {string}  question   - Original question text.
 * @param {string}  cacheKey   - The Redis cache key (used as member ID).
 * @param {boolean} increment  - Whether to increment the score (default: true).
 */
async function recordFaqHit(question, cacheKey, increment = true) {
    try {
        const client = getRedisClient();
        const member = cacheKey.replace(CACHE_KEY_PREFIX, ''); // just the hash

        if (increment) {
            await client.zincrby(FAQ_ZSET_KEY, 1, member);
        } else {
            // Add with score 0 only if not already present
            await client.zadd(FAQ_ZSET_KEY, 'NX', 0, member);
        }

        // Store original text for readability in the stats endpoint
        const textKey = `${FAQ_TEXT_PREFIX}${member}`;
        await client.set(textKey, question, 'EX', CACHE_TTL_SECONDS + 3600); // slightly longer TTL

        // Trim sorted set to keep it lean (keep top MAX_FAQ_ENTRIES by score)
        const total = await client.zcard(FAQ_ZSET_KEY);
        if (total > MAX_FAQ_ENTRIES) {
            // Remove the lowest-scoring entries
            await client.zremrangebyrank(FAQ_ZSET_KEY, 0, total - MAX_FAQ_ENTRIES - 1);
        }

    } catch (err) {
        // Non-critical — silently skip
    }
}

/**
 * Returns cache statistics: hit counts, top FAQs, memory usage.
 * Used by the /api/cache/stats endpoint.
 *
 * @returns {Promise<object>}
 */
async function getCacheStats() {
    try {
        const client = getRedisClient();

        // ── Real Redis memory usage from INFO command ────────────────────────
        let usedMemoryMb  = null;
        let usagePercent  = null;
        let memoryBreakdown = {};
        try {
            const info = await client.info('memory');
            const usedMatch = info.match(/used_memory:(\d+)/);
            const rssMatch  = info.match(/used_memory_rss:(\d+)/);
            const peakMatch = info.match(/used_memory_peak:(\d+)/);

            if (usedMatch) {
                usedMemoryMb  = (parseInt(usedMatch[1]) / 1024 / 1024).toFixed(2);
                usagePercent  = ((parseFloat(usedMemoryMb) / REDIS_MAX_MEMORY_MB) * 100).toFixed(1);
                memoryBreakdown = {
                    usedMB:  parseFloat(usedMemoryMb),
                    rssMB:   rssMatch  ? (parseInt(rssMatch[1])  / 1024 / 1024).toFixed(2) : null,
                    peakMB:  peakMatch ? (parseInt(peakMatch[1]) / 1024 / 1024).toFixed(2) : null,
                    maxMB:   REDIS_MAX_MEMORY_MB,
                    usagePct: parseFloat(usagePercent),
                    status:  parseFloat(usagePercent) < 70  ? 'healthy'
                           : parseFloat(usagePercent) < 90  ? 'warning'
                           : 'critical'
                };
            }
        } catch (_) { /* Redis INFO not available in all plans */ }

        // ── Count total cached responses ─────────────────────────────────────
        const keys = await client.keys(`${CACHE_KEY_PREFIX}*`);
        const totalCached = keys.length;

        // Estimate cache memory: avg 3KB per entry
        const estimatedCacheKB = totalCached * 3;

        // ── Top 20 most-asked questions (highest score first) ─────────────────
        const topMembers = await client.zrevrange(FAQ_ZSET_KEY, 0, 19, 'WITHSCORES');

        // topMembers is flat: [member, score, member, score, ...]
        const topFaqs = [];
        for (let i = 0; i < topMembers.length; i += 2) {
            const hash      = topMembers[i];
            const hits      = parseInt(topMembers[i + 1]);
            const textKey   = `${FAQ_TEXT_PREFIX}${hash}`;
            const question  = await client.get(textKey) || '(text expired)';

            // Check TTL of the cached response
            const cacheKey  = `${CACHE_KEY_PREFIX}${hash}`;
            const ttl       = await client.ttl(cacheKey);

            topFaqs.push({
                question,
                hits,
                ttlSeconds: ttl,     // -2 = expired/gone, -1 = no expiry
                cached: ttl > 0
            });
        }

        return {
            memory: memoryBreakdown,
            totalCached,
            estimatedCacheKB,
            maxFaqEntries: MAX_FAQ_ENTRIES,
            cacheTtlSeconds: CACHE_TTL_SECONDS,
            topFaqs
        };

    } catch (err) {
        console.warn('[CACHE WARNING] getCacheStats failed:', err.message);
        return { error: err.message, totalCached: 0, topFaqs: [] };
    }
}

/**
 * Flushes all LASAK chat cache keys from Redis.
 * Does NOT clear the FAQ hit tracker (useful for analytics continuity).
 *
 * @returns {Promise<number>} Number of keys deleted.
 */
async function flushCache() {
    try {
        const client = getRedisClient();
        const keys = await client.keys(`${CACHE_KEY_PREFIX}*`);
        if (keys.length === 0) return 0;
        await client.del(...keys);
        console.log(`[CACHE] Flushed ${keys.length} cache entries.`);
        return keys.length;
    } catch (err) {
        console.warn('[CACHE WARNING] flushCache failed:', err.message);
        return 0;
    }
}

module.exports = {
    getCachedResponse,
    setCachedResponse,
    getCacheStats,
    flushCache,
    normalizeQuestion,
    buildCacheKey,
    recordFaqHit
};
