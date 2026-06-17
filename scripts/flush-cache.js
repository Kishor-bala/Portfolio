const { getRedisConnection } = require('./queue');

async function run() {
    console.log('Connecting to Redis...');
    const redis = getRedisConnection();
    try {
        await redis.connect();
        console.log('Connected successfully.');

        // Find all chat cache keys
        const cacheKeys = await redis.keys('lasak:chat:cache:*');
        if (cacheKeys.length > 0) {
            console.log(`Found ${cacheKeys.length} chat cache entries. Deleting...`);
            await redis.del(...cacheKeys);
            console.log('Chat cache entries deleted.');
        } else {
            console.log('No chat cache entries found.');
        }

        // Find and delete FAQ text keys
        const faqTextKeys = await redis.keys('lasak:faq:text:*');
        if (faqTextKeys.length > 0) {
            console.log(`Found ${faqTextKeys.length} FAQ text entries. Deleting...`);
            await redis.del(...faqTextKeys);
            console.log('FAQ text entries deleted.');
        } else {
            console.log('No FAQ text entries found.');
        }

        // Delete FAQ zset key
        const deletedZset = await redis.del('lasak:faq:hits');
        if (deletedZset) {
            console.log('FAQ hit tracker deleted.');
        } else {
            console.log('No FAQ hit tracker found.');
        }

        console.log('✅ Redis cache cleared successfully!');
    } catch (err) {
        console.error('❌ Error flushing cache:', err);
    } finally {
        await redis.quit();
        console.log('Redis connection closed.');
    }
}

run();
