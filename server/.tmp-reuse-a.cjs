const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');

const DIR = path.resolve('.mongo-reuse-probe');
const PORT = 27117;

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const mongod = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1', port: PORT, dbPath: DIR, storageEngine: 'wiredTiger' },
  });
  const c = new MongoClient(mongod.getUri('pulse-chat'));
  await c.connect();
  await c.db('pulse-chat').collection('users').insertOne({ email: 'survivor@x.com' });
  console.log('READY rows:', await c.db('pulse-chat').collection('users').countDocuments());
  await c.close();
  // Simulate the dev server being hard-killed by tsx watch (no exit handlers run).
  setTimeout(() => {
    console.log('HARD KILLING PARENT');
    process.kill(process.pid, 'SIGKILL');
  }, 1500);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
