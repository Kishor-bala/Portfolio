const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let connection = null;
let documentQueue = null;

function getRedisConnection() {
    if (!connection) {
        connection = new IORedis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            password: REDIS_PASSWORD,
            maxRetriesPerRequest: null,
            lazyConnect: true,
            retryStrategy: (times) => {
                // Limit retries when Redis is offline to prevent infinite connection attempts
                if (times > 3) {
                    return null; 
                }
                return Math.min(times * 500, 2000);
            }
        });
        connection.on('error', (err) => {
            // Silence connection errors when running offline fallback
        });
    }
    return connection;
}

function getDocumentQueue() {
    if (!documentQueue) {
        const conn = getRedisConnection();
        documentQueue = new Queue('document-processing', {
            connection: conn,
            checkCompatibility: false,
            defaultJobOptions: {
                // Auto-remove completed jobs — keep only last 20 for debugging
                removeOnComplete: { count: 20 },
                // Auto-remove failed jobs — keep only last 10 for diagnostics
                removeOnFail: { count: 10 },
                // Retry failed jobs up to 2 times before giving up
                attempts: 2,
                backoff: { type: 'exponential', delay: 2000 }
            }
        });
    }
    return documentQueue;
}

module.exports = {
    getDocumentQueue,
    getRedisConnection
};
