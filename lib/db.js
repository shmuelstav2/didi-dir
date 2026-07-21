'use strict';

const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let memoryServer = null;

const DB_NAME = process.env.DB_NAME || 'didi_dir';

async function resolveUri() {
  if (process.env.USE_MEMORY_DB === '1' || !process.env.MONGO_URI) {
    // Local development / tests: spin up an ephemeral in-process MongoDB.
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    console.log('[db] using in-memory MongoDB (development)');
    return memoryServer.getUri();
  }
  return process.env.MONGO_URI;
}

async function connect() {
  if (db) return db;
  const uri = await resolveUri();
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
  });
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes(db);
  console.log(`[db] connected to ${DB_NAME}`);
  return db;
}

async function ensureIndexes(d) {
  await d.collection('users').createIndex({ username: 1 }, { unique: true });
  await d.collection('animals').createIndex({ tag: 1 }, { unique: true });
  await d.collection('animals').createIndex({ status: 1, sex: 1 });
  await d.collection('animals').createIndex({ groupName: 1 });
  await d.collection('animals').createIndex({ motherTag: 1 });
  await d.collection('events').createIndex({ animalTag: 1, date: -1 });
  await d.collection('events').createIndex({ type: 1, date: -1 });
  await d.collection('lambings').createIndex({ date: -1 });
  await d.collection('lambings').createIndex({ motherTag: 1 });
  await d.collection('breeding_groups').createIndex({ name: 1 }, { unique: true });
  await d.collection('treatments').createIndex({ date: 1, status: 1 });
}

function getDb() {
  if (!db) throw new Error('DB not connected');
  return db;
}

async function close() {
  if (client) await client.close();
  if (memoryServer) await memoryServer.stop();
  client = null;
  db = null;
  memoryServer = null;
}

module.exports = { connect, getDb, close, DB_NAME };
