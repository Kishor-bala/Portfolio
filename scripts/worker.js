const { Worker } = require('bullmq');
const path = require('path');
const { getRedisConnection } = require('./queue');
const { processFile, regenerateStructuredKnowledge } = require('./processor');

console.log('Initializing BullMQ worker for "document-processing" queue...');

const worker = new Worker('document-processing', async (job) => {
    console.log(`[WORKER] Received Job ID: ${job.id}`);
    console.log(`[WORKER] Job Name: ${job.name}`);
    console.log(`[WORKER] File Path: ${job.data.filePath}`);

    try {
        // Update job progress
        await job.updateProgress(10);
        
        // Process the file (parse, chunk, embed, index to Qdrant)
        const chunkCount = await processFile(job.data.filePath);
        await job.updateProgress(80);

        // Regenerate the structured folders (courses, faculty, policies, faq, placements) 
        // and consolidate JSON/MD outputs
        console.log(`[WORKER] Regenerating consolidated knowledge base files...`);
        await regenerateStructuredKnowledge();
        await job.updateProgress(100);

        console.log(`[WORKER SUCCESS] Job ${job.id} completed. Indexed ${chunkCount} chunks.`);
        return { success: true, chunksIndexed: chunkCount };
    } catch (error) {
        console.error(`[WORKER ERROR] Job ${job.id} failed:`, error.message);
        throw error;
    }
}, {
    connection: getRedisConnection(),
    concurrency: 1 // process one file at a time
});

worker.on('active', (job) => {
    console.log(`[WORKER] Job ${job.id} has started processing.`);
});

worker.on('failed', (job, err) => {
    console.error(`[WORKER] Job ${job ? job.id : 'unknown'} failed with error:`, err.message);
});

worker.on('completed', (job, result) => {
    console.log(`[WORKER] Job ${job.id} completed successfully. Result:`, result);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Worker shutting down...');
    await worker.close();
    process.exit(0);
});

module.exports = worker;
