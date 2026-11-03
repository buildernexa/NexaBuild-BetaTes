import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import uploadChunk from '../api/upload/chunk.js';
import finalizeUpload from '../api/upload/finalize.js';
import jobStatus from '../api/jobs/[id].js';
import downloadApk from '../api/jobs/[id]/apk.js';

const CONFIG_KEYS = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_DEFAULT_BRANCH', 'NEXABUILDER_ACCESS_KEY'];
const UUID = 'b2e7c7de-a1e4-4d6d-9a62-59b5b1cc2b6f';
const SHA1 = 'a'.repeat(40);
const SHA256 = 'b'.repeat(64);

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = String(body); this.finished = true; },
    json() { return JSON.parse(this.body); },
  };
}

async function invoke(handler, req) {
  const res = responseMock();
  await handler(req, res);
  return res;
}

function setValidConfig() {
  process.env.GITHUB_TOKEN = 'ghp_test_token_for_unit_tests';
  process.env.GITHUB_OWNER = 'nexa-owner';
  process.env.GITHUB_REPO = 'nexabuild-test';
  process.env.GITHUB_DEFAULT_BRANCH = 'main';
  process.env.NEXABUILDER_ACCESS_KEY = 'test-access-key-with-more-than-24-chars';
}

function clearConfig() {
  for (const key of CONFIG_KEYS) delete process.env[key];
}

function authorizedReq(extra = {}) {
  return {
    method: 'POST',
    headers: { 'x-nexabuilder-key': 'test-access-key-with-more-than-24-chars' },
    ...extra,
  };
}

test('health endpoint returns explicit method, readiness and configuration responses', async () => {
  const previous = Object.fromEntries(CONFIG_KEYS.map(key => [key, process.env[key]]));
  try {
    clearConfig();
    const method = await invoke(health, { method: 'POST', headers: {} });
    assert.equal(method.statusCode, 405);
    assert.equal(method.headers.allow, 'GET');
    const notReady = await invoke(health, { method: 'GET', headers: {} });
    assert.equal(notReady.statusCode, 503);
    assert.match(notReady.json().error, /belum dikonfigurasi/);
    assert.equal(notReady.json().ok, false);
    assert.equal(notReady.json().ready, false);
    setValidConfig();
    const ready = await invoke(health, { method: 'GET', headers: {} });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().ok, true);
    assert.equal(ready.json().ready, true);
  } finally {
    for (const key of CONFIG_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('upload chunk rejects method, missing authentication and invalid upload IDs before network calls', async () => {
  const previous = Object.fromEntries(CONFIG_KEYS.map(key => [key, process.env[key]]));
  try {
    setValidConfig();
    const method = await invoke(uploadChunk, { method: 'GET', headers: {} });
    assert.equal(method.statusCode, 405);
    const unauthorized = await invoke(uploadChunk, { method: 'POST', headers: {} });
    assert.equal(unauthorized.statusCode, 401);
    const invalidId = await invoke(uploadChunk, authorizedReq({
      url: '/api/upload/chunk?uploadId=invalid&kind=project&index=0&totalChunks=1',
      headers: { 'x-nexabuilder-key': process.env.NEXABUILDER_ACCESS_KEY },
    }));
    assert.equal(invalidId.statusCode, 400);
    assert.match(invalidId.json().error, /ID upload tidak valid/);
  } finally {
    for (const key of CONFIG_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('upload finalizer rejects invalid JSON, invalid manifests, bad chunk sizes and oversized archives', async () => {
  const previous = Object.fromEntries(CONFIG_KEYS.map(key => [key, process.env[key]]));
  try {
    setValidConfig();
    const method = await invoke(finalizeUpload, { method: 'GET', headers: {} });
    assert.equal(method.statusCode, 405);
    const unauthorized = await invoke(finalizeUpload, { method: 'POST', headers: {}, body: '{}' });
    assert.equal(unauthorized.statusCode, 401);
    const invalidJson = await invoke(finalizeUpload, authorizedReq({ body: '{bad json' }));
    assert.equal(invalidJson.statusCode, 400);

    const validBase = {
      uploadId: UUID, fileName: 'project.zip', byteSize: 1,
      blobShas: [SHA1], chunkSizes: [1], archiveSha256: SHA256,
      appName: 'Nexa Test', packageId: 'com.nexa.test', version: '1.0.0', versionCode: 1,
    };
    const badChunkSize = await invoke(finalizeUpload, authorizedReq({ body: { ...validBase, chunkSizes: [2] } }));
    assert.equal(badChunkSize.statusCode, 400);
    assert.match(badChunkSize.json().error, /Ukuran chunk tidak sesuai/);
    const oversized = await invoke(finalizeUpload, authorizedReq({ body: { ...validBase, byteSize: 40 * 1024 * 1024 + 1 } }));
    assert.equal(oversized.statusCode, 413);
    const badMetadata = await invoke(finalizeUpload, authorizedReq({ body: { ...validBase, packageId: 'not-an-id' } }));
    assert.equal(badMetadata.statusCode, 400);
  } finally {
    for (const key of CONFIG_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('job status and APK download endpoints reject unsupported methods and malformed IDs', async () => {
  const previous = Object.fromEntries(CONFIG_KEYS.map(key => [key, process.env[key]]));
  try {
    setValidConfig();
    const method = await invoke(jobStatus, { method: 'POST', headers: {} });
    assert.equal(method.statusCode, 405);
    const unauthorized = await invoke(jobStatus, { method: 'GET', headers: {}, query: { id: UUID } });
    assert.equal(unauthorized.statusCode, 401);
    const invalidStatusId = await invoke(jobStatus, {
      method: 'GET', headers: { 'x-nexabuilder-key': process.env.NEXABUILDER_ACCESS_KEY }, query: { id: 'bad-id' },
    });
    assert.equal(invalidStatusId.statusCode, 400);
    const invalidDownloadId = await invoke(downloadApk, { method: 'GET', headers: {}, query: { id: 'bad-id' } });
    assert.equal(invalidDownloadId.statusCode, 400);
    const invalidSignature = await invoke(downloadApk, { method: 'GET', headers: {}, query: { id: UUID, expires: '9999999999', sig: 'not-a-valid-signature' } });
    assert.equal(invalidSignature.statusCode, 403);
  } finally {
    for (const key of CONFIG_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
