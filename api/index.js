const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const { getQueryEmbedding } = require('../scripts/embedder');
const { searchVector } = require('../scripts/qdrant');
const { getCachedResponse, setCachedResponse, getCacheStats, flushCache } = require('../scripts/cache');
const { RedisStore } = require('rate-limit-redis');
const { getRedisConnection } = require('../scripts/queue');

const app = express();
const PORT = process.env.PORT || 8080;

// 1. Enable compression
app.use(compression());

// 2. Configure Helmet with a robust Content Security Policy (CSP)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
                "'self'", 
                "http://localhost:*",
                "http://127.0.0.1:*",
                "https://generativelanguage.googleapis.com",
                "https://api.openai.com",
                "https://api.anthropic.com",
                "https://api.groq.com",
                "https://api.emailjs.com"
            ]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// 3. Configure strict CORS policies (allowing localhost, allowed origins, and Vercel preview domains)
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'https://lasak.in',
        'https://lasakedu.in'
      ];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        
        const isLocalhost = origin.startsWith('http://localhost:') || 
                            origin.startsWith('http://127.0.0.1:') || 
                            origin === 'http://localhost' || 
                            origin === 'http://127.0.0.1';
                            
        const isVercelDomain = origin.endsWith('.vercel.app') || 
                               origin.includes('.projects.vercel.app');
                            
        const isAllowedDomain = allowedOrigins.indexOf(origin) !== -1;
        
        if (isAllowedDomain || isLocalhost || isVercelDomain) {
            callback(null, true);
        } else {
            callback(new Error('CORS Policy: Origin not allowed.'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Trust reverse proxy (depth is configurable based on deployment environment)
let trustProxyVal = process.env.TRUST_PROXY;
if (trustProxyVal === 'true') {
    trustProxyVal = true;
} else if (trustProxyVal === 'false') {
    trustProxyVal = false;
} else if (trustProxyVal && !isNaN(trustProxyVal)) {
    trustProxyVal = parseInt(trustProxyVal, 10);
} else if (!trustProxyVal) {
    trustProxyVal = 1;
}
app.set('trust proxy', trustProxyVal);

// 4. Redis-backed Rate Limiting
// ────────────────────────────────────────────────────────────────────────────────
//
// WHY REDIS STORE?
// In PM2 cluster mode, each worker process has its own in-memory state.
// Without a shared store, a user hitting Worker A (15 reqs) then Worker B (15 reqs)
// would bypass a per-IP limit of 15. Redis stores ALL counters centrally so all
// workers enforce the same limit — regardless of which worker handles the request.
//
// Rate limits are stored as: lasak:rl:<limiter-prefix>:<ip-address>
// ─────────────────────────────────────────────────────────────────────────────

const redisClientForLimiter = getRedisConnection();

// Helper: build a RedisStore for a given key prefix
function makeRedisStore(prefix) {
    return new RedisStore({
        prefix: `lasak:rl:${prefix}:`,
        // ioredis: call commands dynamically (e.g. client.incrby, client.expire)
        sendCommand: (...args) => {
            const [command, ...params] = args;
            return redisClientForLimiter[command.toLowerCase()](...params);
        }
    });
}

// Global limiter: 200 requests per 15 min per IP (all routes)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('global'),
    skip: () => !redisClientForLimiter.status || redisClientForLimiter.status === 'end', // fallback: skip if Redis offline
    message: { status: 'error', message: 'Too many requests from this IP, please try again after 15 minutes.' }
});

// Chat limiter: 30 AI chat requests per 15 min per IP (~2/min per IP)
// Generous for normal users; prevents single-IP abuse of Gemini API budget
const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('chat'),
    skip: () => !redisClientForLimiter.status || redisClientForLimiter.status === 'end',
    message: { status: 'error', message: 'Chat rate limit reached. Please wait a moment before sending more messages.' }
});

// API limiter: 60 requests per 15 min per IP (enquiry, cache stats, health)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('api'),
    skip: () => !redisClientForLimiter.status || redisClientForLimiter.status === 'end',
    message: { status: 'error', message: 'Too many API requests from this IP. Please try again after 15 minutes.' }
});

app.use(globalLimiter);
app.use('/api/chat', chatLimiter);  // strictest — hits Gemini + Qdrant
app.use('/api/', apiLimiter);        // moderate — enquiry, cache, health

// 5. Body payload limit to prevent entity-too-large attacks
app.use(express.json({ limit: '20kb' }));

// Consolidated JSON Database is loaded directly inside retrieveRagContext()

/**
 * Searches top-level files in the knowledge/ folder (consolidated markdown
 * and raw text extraction) for paragraphs/pages matching query keywords.
 */
async function getLocalFolderContext(query) {
    const queryLower = query.toLowerCase();
    
    // Extract query keywords (filtering out general English stop words, but keeping domain terms)
    const stopWords = new Set(["what", "when", "where", "who", "whom", "which", "whose", "how", "why", "this", "that", "these", "those", "then", "there", "their", "them", "they", "from", "with", "have", "been", "would", "could", "should", "your", "about", "were", "was", "are", "and", "the", "for", "you", "out", "our", "him", "her", "she", "has", "had", "did", "does", "can", "into"]);
    const keywords = queryLower
        .split(/[^a-z0-9]+/)
        .filter(k => k.length > 2 && !stopWords.has(k));
    
    // Fallback if no distinct keywords remain
    const searchKeywords = keywords.length > 0 
        ? keywords 
        : queryLower.split(/\s+/).filter(k => k.length > 2);

    if (searchKeywords.length === 0) return '';

    // Calculate dynamic threshold: minimum 2 matches, or searchKeywords.length if it's less than 2
    const minScore = Math.min(2, searchKeywords.length);
    let matchedParts = [];

    // 1. Search in consolidated_knowledge.md (covers courses, faculty, policies, placements, FAQs)
    const consolidatedMdPath = path.join(__dirname, '..', 'knowledge', 'consolidated_knowledge.md');
    try {
        if (fs.existsSync(consolidatedMdPath)) {
            const mdText = await fs.promises.readFile(consolidatedMdPath, 'utf8');
            // Split by markdown headers or logical paragraphs
            const sections = mdText.split(/\n(?=#{2,4} )|\n\n+/);
            for (const section of sections) {
                const sectionLower = section.toLowerCase();
                const matches = searchKeywords.filter(kw => sectionLower.includes(kw));
                if (matches.length >= minScore) {
                    matchedParts.push({
                        text: section.trim(),
                        score: matches.length,
                        source: 'consolidated_knowledge.md'
                    });
                }
            }
        }
    } catch (err) {
        console.error("[RAG ERROR] Failed to read consolidated_knowledge.md asynchronously:", err);
    }

    // 2. Search in KISHOR_BALA_G_PROFILE.md (covers user profile details)
    const rawMdPath = path.join(__dirname, '..', 'knowledge', 'KISHOR_BALA_G_PROFILE.md');
    try {
        if (fs.existsSync(rawMdPath)) {
            const rawText = await fs.promises.readFile(rawMdPath, 'utf8');
            // Split by headings or paragraphs
            const sections = rawText.split(/\n(?=#{2,4} )|\n\n+/);
            for (const section of sections) {
                const sectionLower = section.toLowerCase();
                const matches = searchKeywords.filter(kw => sectionLower.includes(kw));
                if (matches.length >= minScore) {
                    matchedParts.push({
                        text: section.trim(),
                        score: matches.length,
                        source: 'KISHOR_BALA_G_PROFILE.md'
                    });
                }
            }
        }
    } catch (err) {
        console.error("[RAG ERROR] Failed to read KISHOR_BALA_G_PROFILE.md asynchronously:", err);
    }

    // Sort by matches descending and take the top 2 excerpts
    matchedParts.sort((a, b) => b.score - a.score);
    const topMatches = matchedParts.slice(0, 2);

    if (topMatches.length > 0) {
        let resultText = "\n--- ADDITIONAL KNOWLEDGE BASE MATCHES ---\n";
        topMatches.forEach((match, index) => {
            resultText += `[Excerpt ${index + 1} from ${match.source}]\n${match.text}\n\n`;
        });
        return resultText;
    }

    return '';
}

/**
 * Upgraded RAG context retriever.
 * Generates a BGE-M3 embedding for the query and searches QdrantDB.
 * Fallback: Performs search over local compiled knowledge files and root database.
 */
async function retrieveRagContext(query) {
    let semanticContext = '';
    let qdrantOnline = false;
    try {
        console.log(`[RAG] Generating Gemini query embedding for: "${query}"...`);
        const queryEmbedding = await getQueryEmbedding(query);
        console.log(`[RAG] Querying QdrantDB for vector match...`);
        const searchResults = await searchVector(queryEmbedding, 2);
        
        if (searchResults && searchResults.length > 0) {
            qdrantOnline = true;
            semanticContext = "\n--- SEMANTIC SEARCH CONTEXT (QDRANT & Gemini Embedding) ---\n";
            searchResults.forEach((res, i) => {
                semanticContext += `[Source: ${res.payload.source || 'Unknown'}] (Match Confidence: ${(res.score * 100).toFixed(1)}%)\n${res.payload.text}\n\n`;
            });
        }
    } catch (error) {
        console.warn("[RAG WARNING] Qdrant semantic search offline or failed. Error:", error.message);
    }

    // Retrieve fallback keyword-based context from structured JSON
    const fallbackContext = await getFallbackKeywordContext(query);

    // Retrieve context from local files (consolidated files, PDFs, policies, placements, FAQs)
    const localFolderContext = await getLocalFolderContext(query);

    let finalContext = '';
    if (qdrantOnline) {
        finalContext += semanticContext;
    }
    
    if (localFolderContext) {
        finalContext += "\n" + localFolderContext;
    }

    finalContext += "\n--- SYSTEM GENERAL FACTS ---\n" + fallbackContext;

    return finalContext;
}

/**
 * Simple high-precision keyword-based RAG retriever (fallback).
 * Loads lasak_data.json and extracts sections matching query keywords.
 * Also searches the loaded lasak-images_data.txt sections.
 */
async function getFallbackKeywordContext(query) {
    return '';
}

/**
 * Helper to call Groq API as a fallback when Gemini is rate-limited or fails.
 */
async function callGroqAPI(apiKey, systemInstructionText, message, history) {
    console.log("[RAG FALLBACK] Requesting chat generation from Groq (llama-3.3-70b-versatile)...");
    const messages = [{ role: 'system', content: systemInstructionText }];
    history.forEach(turn => {
        const role = (turn.role === 'assistant' || turn.role === 'model') ? 'assistant' : 'user';
        messages.push({ role: role, content: turn.text || '' });
    });
    messages.push({ role: 'user', content: message });

    const requestBody = {
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.2
    };

    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned status ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    if (!resJson.choices || !resJson.choices[0] || !resJson.choices[0].message || !resJson.choices[0].message.content) {
        throw new Error(`Invalid response structure from Groq API: ${JSON.stringify(resJson)}`);
    }
    return resJson.choices[0].message.content;
}

/**
 * Unified helper to generate responses trying multiple configured keys/providers in sequence.
 * Falls back in order: Gemini -> OpenAI -> Anthropic -> Groq.
 */
async function generateLLMResponse(systemInstructionText, message, history, customApiKey) {
    const chain = [];

    // If custom API key is sent via request body, prioritize it
    if (customApiKey) {
        let provider = 'gemini';
        if (customApiKey.startsWith('sk-ant-')) provider = 'anthropic';
        else if (customApiKey.startsWith('sk-')) provider = 'openai';
        chain.push({ provider, apiKey: customApiKey });
    } else {
        // 1. Try Gemini Keys first from env variables (supporting plural list or singular key)
        const geminiEnvKeys = [];
        if (process.env.GEMINI_API_KEYS) {
            geminiEnvKeys.push(...process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean));
        } else if (process.env.GEMINI_API_KEY) {
            geminiEnvKeys.push(process.env.GEMINI_API_KEY.trim());
        }

        geminiEnvKeys.forEach(key => {
            chain.push({ provider: 'gemini', apiKey: key });
        });

        // 2. Next try OpenAI key
        const openaiKeyToUse = process.env.OPENAI_API_KEY;
        if (openaiKeyToUse) {
            chain.push({ provider: 'openai', apiKey: openaiKeyToUse });
        }

        // 3. Finally try Groq key
        const groqKeyToUse = process.env.GROQ_API_KEY;
        if (groqKeyToUse) {
            chain.push({ provider: 'groq', apiKey: groqKeyToUse });
        }
    }

    let lastError = null;

    for (const link of chain) {
        const { provider, apiKey } = link;
        try {
            console.log(`[LLM] Attempting generation via provider: "${provider}"...`);
            if (provider === 'gemini') {
                const contents = history.map(turn => {
                    const role = (turn.role === 'assistant' || turn.role === 'model') ? 'model' : 'user';
                    return {
                        role: role,
                        parts: [{ text: turn.text || '' }]
                    };
                });
                contents.push({
                    role: "user",
                    parts: [{ text: message }]
                });

                const requestBody = {
                    contents: contents,
                    systemInstruction: {
                        parts: [{ text: systemInstructionText }]
                    },
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.95,
                        maxOutputTokens: 2048
                    }
                };

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Gemini API returned status ${response.status}: ${errText}`);
                }

                const resJson = await response.json();
                if (!resJson.candidates || !resJson.candidates[0] || !resJson.candidates[0].content || !resJson.candidates[0].content.parts || !resJson.candidates[0].content.parts[0]) {
                    throw new Error(`Invalid response structure from Gemini API`);
                }
                return resJson.candidates[0].content.parts[0].text;

            } else if (provider === 'openai') {
                const messages = [{ role: 'system', content: systemInstructionText }];
                history.forEach(turn => {
                    const role = (turn.role === 'assistant' || turn.role === 'model') ? 'assistant' : 'user';
                    messages.push({ role: role, content: turn.text || '' });
                });
                messages.push({ role: 'user', content: message });

                const requestBody = {
                    model: 'gpt-4o-mini',
                    messages: messages,
                    temperature: 0.2
                };

                const url = 'https://api.openai.com/v1/chat/completions';
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`OpenAI API returned status ${response.status}: ${errText}`);
                }

                const resJson = await response.json();
                if (!resJson.choices || !resJson.choices[0] || !resJson.choices[0].message || !resJson.choices[0].message.content) {
                    throw new Error(`Invalid response structure from OpenAI API`);
                }
                return resJson.choices[0].message.content;

            } else if (provider === 'anthropic') {
                const messages = [];
                history.forEach(turn => {
                    const role = (turn.role === 'assistant' || turn.role === 'model') ? 'assistant' : 'user';
                    messages.push({ role: role, content: turn.text || '' });
                });
                messages.push({ role: 'user', content: message });

                const requestBody = {
                    model: 'claude-3-5-haiku-20241022',
                    system: systemInstructionText,
                    messages: messages,
                    max_tokens: 2048,
                    temperature: 0.2
                };

                const url = 'https://api.anthropic.com/v1/messages';
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Anthropic API returned status ${response.status}: ${errText}`);
                }

                const resJson = await response.json();
                if (!resJson.content || !resJson.content[0] || !resJson.content[0].text) {
                    throw new Error(`Invalid response structure from Anthropic API`);
                }
                return resJson.content[0].text;

            } else if (provider === 'groq') {
                return await callGroqAPI(apiKey, systemInstructionText, message, history);
            }
        } catch (err) {
            console.warn(`[LLM WARNING] Provider "${provider}" failed:`, err.message);
            lastError = err;
        }
    }

    throw new Error(`All configured LLM providers failed. Last error: ${lastError ? lastError.message : 'Unknown error'}`);
}

/**
 * Middleware: Admin Authorization check for cache stats & flush routes.
 */
function adminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const expectedKey = process.env.ADMIN_SECRET_KEY;
    
    if (!expectedKey) {
        console.warn("[SECURITY ALERT] Cache administration attempted but no ADMIN_SECRET_KEY is defined in configuration.");
        return res.status(403).json({ status: "error", message: "Forbidden: Cache administration is disabled (missing key)." });
    }
    
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        token = req.headers['x-admin-key'] || '';
    }
    
    if (token !== expectedKey) {
        return res.status(401).json({ status: "error", message: "Unauthorized: Invalid admin credentials." });
    }
    
    next();
}

// POST endpoint: /api/chat
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [], apiKey = '' } = req.body;
        if (!message) {
            return res.status(400).json({ status: "error", message: "Message is required." });
        }

        // ── Redis Cache Check ────────────────────────────────────────────────
        // Only cache standalone questions (no history). Conversation follow-ups
        // are context-dependent and must always be freshly generated.
        const isStandaloneQuestion = history.length === 0;
        if (isStandaloneQuestion) {
            const cached = await getCachedResponse(message);
            if (cached) {
                console.log(`[CACHE] Serving cached response. Saved an API call! 💰`);
                return res.json({
                    status: "success",
                    reply: cached.reply,
                    cached: true,
                    cachedAt: cached.cachedAt
                });
            }
        }

        // Perform RAG retrieval (both Qdrant vector search and JSON keyword fallback)
        const context = await retrieveRagContext(message);

        const systemInstructionText = 
            "You are Portfolio Assistant, a friendly, warm, and natural AI portfolio helper representing Kishor Bala G.\n\n" +
            "ROLE & GUIDELINES:\n" +
            "1. Speak in a friendly, warm, and natural conversational voice, as if you are Kishor yourself. Always refer to yourself in the first person (e.g., 'I am studying...', 'In my project...', 'I completed an internship at...') to make the interaction feel personal and human.\n" +
            "2. Structure your response clearly using paragraph breaks, lists, and bold text for titles/key terms. **CRITICAL: DO NOT use `#` characters (such as #, ##, ###, ####) for headings** in your response under any circumstances. Keep the layout neat and readable without any hash symbols.\n" +
            "3. Strictly base your answers ONLY on the provided OFFICIAL DATABASE CONTEXT below. Never invent details or refer to external facts. If the context does not contain the answer, politely state that you do not have that specific details and suggest contacting me directly at kishorbala003@gmail.com.\n\n" +
            "RRN (Represent, Redirect, Navigate) RESPONSE FORMULA:\n" +
            "For every query, ensure you integrate these three elements naturally and conversationally:\n" +
            "- **Represent**: Explain my details clearly with precise facts from the context (e.g. education, skills, projects, duration, role).\n" +
            "- **Redirect**: Guide the user to contact me: Email (kishorbala003@gmail.com) or LinkedIn (www.linkedin.com/in/kishor-bala-g-a28a23257).\n" +
            "- **Navigate**: Provide direct links to my LinkedIn or GitHub (https://github.com/Kishor-bala) so the user can easily take the next step.\n\n" +
            "COGNITIVE BOUNDARIES:\n" +
            "- If the user asks general-knowledge questions, code writing requests, or topics completely unrelated to my portfolio, politely refuse to answer. Explain that you are dedicated to assisting with inquiries about my skills, experience, and projects.\n\n" +
            "FOLLOW-UP SUGGESTIONS:\n" +
            "At the very end of your response, you MUST generate exactly 2 or 3 relevant suggestions for follow-up questions that the user might want to ask next. You MUST format each suggested question on a new line at the absolute end of the response EXACTLY like this:\n" +
            "[Suggestion: suggested question text?]\n" +
            "Do not include any other text or formatting around these brackets.\n\n" +
            "--- OFFICIAL DATABASE CONTEXT ---\n" +
            `${context}\n`;

        // Generate response via the failover chain
        const replyText = await generateLLMResponse(systemInstructionText, message, history, apiKey);

        // ── Cache the fresh response ─────────────────────────────────────
        // Store the reply in Redis for future identical questions (no history only)
        if (isStandaloneQuestion && replyText) {
            await setCachedResponse(message, replyText);
        }

        res.json({ status: "success", reply: replyText, cached: false });
    } catch (e) {
        console.error("Chat API Error:", e);
        res.status(500).json({ status: "error", message: "High demand. Response cannot be generated now. Please try again later." });
    }
});

// POST endpoint: /api/enquiry
app.post('/api/enquiry', (req, res) => {
    try {
        const { name = 'Anonymous', email = 'N/A', phone = 'N/A', course = 'General', message = '' } = req.body;

        console.log(`\n--- NEW ENQUIRY ---`);
        console.log(`Name: ${name}`);
        console.log(`Email: ${email}`);
        console.log(`Phone: ${phone}`);
        console.log(`Course Interest: ${course}`);
        console.log(`Message: ${message}`);
        console.log(`-------------------\n`);

        res.json({ status: "success", message: "Enquiry registered successfully!" });
    } catch (e) {
        console.error("Enquiry API Error:", e);
        res.status(500).json({ status: "error", message: e.message });
    }
});

// GET endpoint: /api/cache/stats
// Returns top frequently asked questions and cache performance metrics (secured)
app.get('/api/cache/stats', adminAuth, async (req, res) => {
    try {
        const stats = await getCacheStats();
        res.json({ status: "success", ...stats });
    } catch (e) {
        console.error("Cache Stats Error:", e);
        res.status(500).json({ status: "error", message: e.message });
    }
});

// DELETE endpoint: /api/cache/flush
// Clears all cached chat responses (secured)
app.delete('/api/cache/flush', adminAuth, async (req, res) => {
    try {
        const deleted = await flushCache();
        res.json({
            status: "success",
            message: `Flushed ${deleted} cache entries. FAQ hit history preserved.`,
            deletedCount: deleted
        });
    } catch (e) {
        console.error("Cache Flush Error:", e);
        res.status(500).json({ status: "error", message: e.message });
    }
});

// GET endpoint: /api/health
// Lightweight health check for PM2, load balancers, and deployment platforms
app.get('/api/health', (req, res) => {
    const mem = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        uptimeHuman: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
        memory: {
            heapUsedMB: (mem.heapUsed  / 1024 / 1024).toFixed(1),
            heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1),
            rssMB: (mem.rss / 1024 / 1024).toFixed(1)
        },
        node: process.version,
        pid: process.pid,
        timestamp: new Date().toISOString()
    });
});

// Serve static files from portfolio-MineCraft directory
const portfolioDir = path.join(__dirname, '..');
app.use(express.static(portfolioDir));

// Direct default route (just in case) to serve index.html from portfolio-MineCraft
app.get('*', (req, res) => {
    if (process.env.VERCEL === '1') {
        return res.status(404).json({ error: "Endpoint not found" });
    }
    res.sendFile(path.join(portfolioDir, 'index.html'));
});

// Start the server
function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`Starting Lasak AI server on http://localhost:${port}...`);
        console.log("Server online. Press Ctrl+C to terminate.");
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is already in use, trying next port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error("Server error:", err);
        }
    });
}

// ── Cluster-Safe File Watcher ──────────────────────────────────────────────────────────────
// In PM2 cluster mode, NODE_APP_INSTANCE is set to 0, 1, 2... for each worker.
// We only want ONE worker to run the file watcher to prevent N duplicate watchers
// all firing events and submitting duplicate jobs to the BullMQ queue.
// Instance 0 is elected as the watcher leader. In non-PM2 mode (NODE_APP_INSTANCE
// is undefined), the check also passes so local dev works normally.
// Note: We bypass the file watcher completely on serverless platforms (like Vercel).
const isVercel = process.env.VERCEL === '1';
const isPrimaryInstance = (!process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0') && !isVercel;

if (isPrimaryInstance) {
    console.log(`[SERVER] Instance ${process.env.NODE_APP_INSTANCE || '0'} elected as watcher leader. Starting file watcher...`);
    require('../scripts/watcher.js');
} else if (!isVercel) {
    console.log(`[SERVER] Instance ${process.env.NODE_APP_INSTANCE} is a worker. Skipping file watcher (leader is instance 0).`);
}

// ── Startup & Vercel Serverless Export ──────────────────────────────────────────────────
if (!isVercel) {
    startServer(parseInt(PORT));
}

module.exports = app;
