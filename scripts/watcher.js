const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { getDocumentQueue, getRedisConnection } = require('./queue');

let useQueue = false;

// Dynamically check Redis connection to load worker or fall back cleanly
const redisConn = getRedisConnection();

function enableQueue() {
    console.log('[WATCHER] Redis connection established. Enabling BullMQ background queue.');
    useQueue = true;
    require('./worker');
}

if (redisConn.status === 'ready' || redisConn.status === 'connect') {
    enableQueue();
} else if (redisConn.status === 'connecting') {
    console.log('[WATCHER] Redis connection is already connecting. Waiting for ready event...');
    redisConn.once('ready', () => {
        enableQueue();
    });
} else {
    redisConn.connect()
        .then(() => {
            enableQueue();
        })
        .catch((err) => {
            if (err.message.includes('already connecting') || err.message.includes('already connected')) {
                console.log('[WATCHER] Redis is already connecting/connected. Enabling BullMQ background queue.');
                enableQueue();
            } else {
                console.log(`[WATCHER] Redis offline. Watcher running in direct-processing fallback mode (zero-dependencies). Error: ${err.message}`);
            }
        });
}

const rootDir = path.resolve(__dirname, '..');
const knowledgeDir = path.join(rootDir, 'knowledge');

console.log(`Starting file watcher on: ${knowledgeDir}`);

// Watch knowledgeDir recursively
const watcher = chokidar.watch(knowledgeDir, {
    ignored: (filePath) => {
        // Normalize backslashes to forward slashes for cross-platform matching
        const normalizedPath = filePath.replace(/\\/g, '/');
        const fileName = path.basename(normalizedPath);

        // Ignore dotfiles
        if (/(^|[\/\\])\../.test(normalizedPath)) return true;

        // Ignore consolidated files
        if (fileName === 'consolidated_knowledge.json' || fileName === 'consolidated_knowledge.md') return true;

        return false;
    },
    persistent: true,
    ignoreInitial: true // Set to true so initial files don't trigger events on startup
});

const handleFile = async (filePath, action) => {
    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            return;
        }
    } catch (e) {
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf' || ext === '.json' || ext === '.md' || ext === '.txt') {
        const fileName = path.basename(filePath);
        
        // Safety check for consolidated names
        if (fileName === 'consolidated_knowledge.json' || fileName === 'consolidated_knowledge.md') {
            return;
        }
        
        console.log(`[WATCHER] File ${action}: ${fileName}`);
        if (useQueue) {
            try {
                const job = await getDocumentQueue().add('process-document', {
                    filePath: path.resolve(filePath),
                    fileName: fileName
                });
                console.log(`[WATCHER] Job queued successfully for "${fileName}". Job ID: ${job.id}`);
                return;
            } catch (err) {
                console.warn(`[WATCHER WARNING] Failed to queue job for "${fileName}": ${err.message}. Retrying directly.`);
            }
        }

        // Direct processing fallback (used when Redis is offline or queueing fails)
        try {
            console.log(`[WATCHER] Processing file directly: ${fileName}`);
            const { processFile, regenerateStructuredKnowledge } = require('./processor');
            const chunkCount = await processFile(filePath);
            console.log(`[WATCHER SUCCESS] Directly indexed ${chunkCount} chunks for "${fileName}".`);
            await regenerateStructuredKnowledge();
        } catch (directErr) {
            console.error(`[WATCHER ERROR] Direct processing failed for "${fileName}":`, directErr.message);
        }
    }
};

const handleFileDelete = async (filePath) => {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.pdf' || ext === '.json' || ext === '.md' || ext === '.txt') {
        if (fileName === 'consolidated_knowledge.json' || fileName === 'consolidated_knowledge.md') {
            return;
        }

        console.log(`[WATCHER] File DELETED: ${fileName}`);
        
        // Delete points from Qdrant Cloud
        try {
            const { deletePointsBySource } = require('./qdrant');
            await deletePointsBySource(fileName);
        } catch (err) {
            console.error(`[WATCHER ERROR] Failed to delete points for "${fileName}" from Qdrant:`, err.message);
        }

        // Regenerate structured folders & consolidated files
        try {
            console.log(`[WATCHER] Regenerating consolidated knowledge base...`);
            const { regenerateStructuredKnowledge } = require('./processor');
            await regenerateStructuredKnowledge();
        } catch (err) {
            console.error(`[WATCHER ERROR] Failed to regenerate knowledge after deleting "${fileName}":`, err.message);
        }
    }
};

watcher.on('add', (filePath) => handleFile(filePath, 'ADDED'));
watcher.on('change', (filePath) => handleFile(filePath, 'MODIFIED'));
watcher.on('unlink', (filePath) => handleFileDelete(filePath));
watcher.on('error', (error) => console.error(`[WATCHER ERROR] Chokidar watcher encountered an error: ${error.message}`));

console.log('File watcher is active and listening for new/modified/deleted files...');
