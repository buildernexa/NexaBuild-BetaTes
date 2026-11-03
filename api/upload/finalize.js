import {
  githubApi, getConfig, isAuthorized, sendJson, UUID_RE, SHA_RE,
  MAX_PROJECT_BYTES, MAX_CHUNK_BYTES, validateBuildMetadata, findWorkflowRun,
} from '../../lib/nexa.js';

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Gunakan POST untuk memulai build.' });
  }
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Access key salah atau belum diisi.' });

  const input = parseBody(req);
  if (!input) return sendJson(res, 400, { error: 'Data permintaan tidak dapat dibaca. Coba ulangi build.' });
  const uploadId = String(input.uploadId || '');
  const fileName = String(input.fileName || '').trim().slice(0, 180);
  const byteSize = Number(input.byteSize);
  const blobShas = input.blobShas;
  const chunkSizes = input.chunkSizes;
  const archiveSha256 = String(input.archiveSha256 || '').toLowerCase();
  const iconSha = input.iconSha ? String(input.iconSha) : null;
  if (!UUID_RE.test(uploadId)) return sendJson(res, 400, { error: 'ID upload tidak valid.' });
  if (!fileName.toLowerCase().endsWith('.zip') || /[\u0000-\u001f]/.test(fileName)) return sendJson(res, 400, { error: 'Nama file harus berupa ZIP yang valid.' });
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_PROJECT_BYTES) return sendJson(res, 413, { error: 'Ukuran ZIP harus lebih kecil atau sama dengan 40 MB.' });
  const expectedChunks = Math.ceil(byteSize / MAX_CHUNK_BYTES);
  if (!Array.isArray(blobShas) || blobShas.length !== expectedChunks || blobShas.some(sha => typeof sha !== 'string' || !SHA_RE.test(sha))) {
    return sendJson(res, 400, { error: 'Daftar chunk upload tidak lengkap atau tidak valid. Silakan unggah ulang.' });
  }
  if (!/^[0-9a-f]{64}$/.test(archiveSha256) || !Array.isArray(chunkSizes) || chunkSizes.length !== expectedChunks) {
    return sendJson(res, 400, { error: 'Checksum SHA-256 atau metadata ukuran chunk tidak valid. Upload harus dimulai ulang.' });
  }
  const expectedSizes = blobShas.map((_, index) => Math.min(MAX_CHUNK_BYTES, byteSize - index * MAX_CHUNK_BYTES));
  if (chunkSizes.some((size, index) => !Number.isSafeInteger(size) || size !== expectedSizes[index]) || chunkSizes.reduce((sum, size) => sum + size, 0) !== byteSize) {
    return sendJson(res, 400, { error: 'Ukuran chunk tidak sesuai dengan ukuran ZIP asli.' });
  }
  if (iconSha && !SHA_RE.test(iconSha)) return sendJson(res, 400, { error: 'Data ikon tidak valid.' });

  let metadata;
  try { metadata = validateBuildMetadata(input); }
  catch (error) { return sendJson(res, error.statusCode || 400, { error: error.message }); }

  const uploadRef = `nexabuilder-upload-${uploadId}`;
  let refCreated = false;
  let dispatchAttempted = false;
  try {
    const { branch } = getConfig();
    // Idempotency: never dispatch a second workflow for an upload ID already used.
    let existingRef = null;
    try { existingRef = await githubApi(`/git/ref/heads/${encodeURIComponent(uploadRef)}`); }
    catch (error) { if (error.upstreamStatus !== 404) throw error; }
    if (existingRef?.object?.sha) {
      const existingRun = await findWorkflowRun(uploadId).catch(() => null);
      if (existingRun) return sendJson(res, 202, {
        id: uploadId, status: existingRun.status === 'completed' ? existingRun.conclusion : existingRun.status,
        runUrl: existingRun.html_url,
        message: 'Upload ID ini sudah memiliki workflow. Build ganda tidak dikirim; gunakan status pekerjaan yang sudah ada.',
      });
      return sendJson(res, 409, { error: 'Upload ID sudah digunakan dan branch sementara masih ada. Build baru tidak dikirim untuk mencegah duplikasi.' });
    }
    const head = await githubApi(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const parentSha = head?.object?.sha;
    if (!parentSha) throw Object.assign(new Error('Tidak dapat membaca commit dasar GitHub.'), { statusCode: 502 });
    const parentCommit = await githubApi(`/git/commits/${encodeURIComponent(parentSha)}`);
    const baseTree = parentCommit?.tree?.sha;
    if (!baseTree) throw Object.assign(new Error('Tidak dapat membaca tree repository GitHub.'), { statusCode: 502 });

    const treeEntries = blobShas.map((sha, index) => ({
      path: `.nexabuilder/incoming/${uploadId}/parts/part-${String(index).padStart(3, '0')}.bin`,
      mode: '100644', type: 'blob', sha,
    }));
    if (iconSha) treeEntries.push({
      path: `.nexabuilder/incoming/${uploadId}/icon.bin`, mode: '100644', type: 'blob', sha: iconSha,
    });
    const manifest = {
      schemaVersion: 1, uploadId, byteSize, sha256: archiveSha256,
      chunkSize: MAX_CHUNK_BYTES, chunkCount: expectedChunks,
      parts: chunkSizes.map((size, index) => ({ index, name: `part-${String(index).padStart(3, '0')}.bin`, size })),
    };
    const manifestBlob = await githubApi('/git/blobs', {
      method: 'POST', body: { content: Buffer.from(JSON.stringify(manifest)).toString('base64'), encoding: 'base64' },
    });
    if (!manifestBlob?.sha || !SHA_RE.test(manifestBlob.sha)) throw Object.assign(new Error('GitHub tidak mengonfirmasi penyimpanan manifest upload.'), { statusCode: 502 });
    treeEntries.push({ path: `.nexabuilder/incoming/${uploadId}/manifest.json`, mode: '100644', type: 'blob', sha: manifestBlob.sha });

    const tree = await githubApi('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: treeEntries } });
    const commit = await githubApi('/git/commits', {
      method: 'POST',
      body: { message: `NexaBuilder upload ${uploadId}`, tree: tree.sha, parents: [parentSha] },
    });
    try {
      await githubApi('/git/refs', { method: 'POST', body: { ref: `refs/heads/${uploadRef}`, sha: commit.sha } });
      refCreated = true;
    } catch (createError) {
      let confirmed = null;
      try { confirmed = await githubApi(`/git/ref/heads/${encodeURIComponent(uploadRef)}`); }
      catch (readError) { if (readError.upstreamStatus !== 404) throw createError; }
      if (confirmed?.object?.sha !== commit.sha) throw createError;
      refCreated = true;
    }

    dispatchAttempted = true;
    await githubApi('/actions/workflows/build.yml/dispatches', {
      method: 'POST',
      body: {
        ref: branch,
        inputs: {
          upload_id: uploadId,
          upload_ref: uploadRef,
          app_name: metadata.appName,
          package_id: metadata.packageId,
          app_version: metadata.version,
          version_code: metadata.versionCode,
          archive_size: String(byteSize),
          archive_sha256: archiveSha256,
          chunk_count: String(expectedChunks),
          internet_mode: input.internetMode === 'offline' ? 'offline' : 'online',
          camera_permission: String(input.cameraPermission === true || input.cameraPermission === 'true'),
          wake_lock: String(input.wakeLock === true || input.wakeLock === 'true'),
          vibrate_permission: String(input.vibratePermission === true || input.vibratePermission === 'true'),
        },
      },
    });

    return sendJson(res, 202, {
      id: uploadId,
      status: 'queued',
      message: 'Project tersimpan dan workflow build telah diminta. Memantau status GitHub Actions.',
    });
  } catch (error) {
    const upstreamStatus = Number(error.upstreamStatus || 0);
    const status = Number(error.statusCode || 0);
    const definitiveDispatchRejection = [400, 401, 403, 404, 409, 422].includes(upstreamStatus || status);
    // A timeout/5xx can occur after GitHub accepted workflow_dispatch. Never
    // delete the input ref on an ambiguous response: the runner may still need it.
    if (refCreated && (!dispatchAttempted || definitiveDispatchRejection)) {
      try { await githubApi(`/git/refs/heads/${encodeURIComponent(uploadRef)}`, { method: 'DELETE' }); }
      catch { /* Best-effort cleanup; detailed error below is more useful. */ }
    }
    if (refCreated && dispatchAttempted && !definitiveDispatchRejection) {
      return sendJson(res, 202, {
        id: uploadId,
        status: 'dispatch_uncertain',
        uploadRef,
        message: 'GitHub belum mengonfirmasi workflow_dispatch. Branch upload tetap dipertahankan karena runner mungkin sudah menerima permintaan. Periksa tab Actions sebelum mengirim build ulang.',
      });
    }
    const message = /workflow/i.test(error.message || '') && (error.statusCode === 404 || upstreamStatus === 404)
      ? 'Workflow .github/workflows/build.yml belum ditemukan pada default branch. Unggah semua file NexaBuilder ke repository, lalu coba lagi.'
      : (error.message || 'Gagal menyiapkan workflow build.');
    return sendJson(res, error.statusCode || 502, { error: message });
  }
}
