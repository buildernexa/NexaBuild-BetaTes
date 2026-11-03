# Engine contracts — APKit external service and NexaBuild Vercel bridge

Default URL: `https://apkit.onrender.com`.

1. `GET /api/health` → expected `{ "ok": true }`.
2. `POST /api/upload` → `multipart/form-data`, archive field must be named `zip`; optional engine-specific fields are not sent unless supported. The public implementation returns a `jobId` for tracking.
3. `GET /api/status/{jobId}` → status fields include `status`, `step`, `stepProgress`, `logs`, `error`, and `downloadReady`.
4. `GET /api/logs/{jobId}/stream` → server-sent events used for live logs and step status.
5. `GET /api/download/{jobId}` → returns the APK only when the job succeeds and an artifact is ready. The service may purge that job's files after download.

Important: the upload route itself accepts the archive and optional permissions; it does not accept per-job name/package ID/version/icon. NEXA prepares app name and Application ID inside the archive for compatible web projects without their own Capacitor config. Native projects and projects with custom Capacitor config are not rewritten. Version code/name and launcher icon still need backend-side support; the UI does not claim they were applied.


## Optional authentication
- `POST /api/auth/signup` or `POST /api/auth/login` with JSON `{ "email": "...", "password": "..." }` returns a session token when enabled.
- The dashboard keeps this token in `sessionStorage` for the current tab only; status calls use `Authorization: Bearer ...`. SSE and download use the token query parameter because `EventSource` and ordinary download links cannot set custom headers.
- No credentials are requested at startup. If an upload receives HTTP 401, the engine settings dialog opens and explains that it needs an engine-specific account.
- `POST /api/auth/logout` is called when possible, then the local tab session is cleared.

## Latest reachability note
The health endpoint answered successfully during the initial integration check, but a later external probe returned `target_unreachable`. Test the engine from the device/network running the dashboard before assuming it is online. The actual APK compilation has not yet been verified end-to-end.


---

## NexaBuild Vercel bridge (`api/`)

Bagian ini adalah serverless bridge milik repository, terpisah dari URL APKit di atas. Route ini membutuhkan environment variables `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_DEFAULT_BRANCH` (opsional, default `main`), dan `NEXABUILDER_ACCESS_KEY` (minimal 24 karakter). Request privat memakai header `x-nexabuilder-key`. Jangan menyimpan key backend di frontend/browser.

| Route | Method | Fungsi |
|---|---|---|
| `/api/health` | GET | Memeriksa konfigurasi; mengembalikan `ok` dan `ready`. |
| `/api/upload/chunk?uploadId=...&kind=project&index=0&totalChunks=...` | POST | Menyimpan satu potongan Git blob; isi raw binary, `Content-Type: application/octet-stream`. Balasan berisi `sha`, `bytes`, dan indeks. |
| `/api/upload/finalize` | POST | Menerima JSON `uploadId`, `fileName`, `byteSize`, `blobShas[]`, `chunkSizes[]`, `archiveSha256`, metadata aplikasi, opsi permission, dan `iconSha` opsional. Memvalidasi ukuran/checksum metadata, membuat branch upload, lalu meminta `workflow_dispatch`. |
| `/api/jobs/{id}` | GET | Membaca status GitHub Actions; membutuhkan access key. Status bukan bukti APK siap kecuali `success` dan asset sudah ditemukan. |
| `/api/jobs/{id}/apk?expires=...&sig=...` | GET | Redirect hanya bila signature HMAC masih valid dan workflow sukses serta APK Release ditemukan. Link berlaku singkat (10 menit). |

Bridge memeriksa ulang file dengan manifest SHA-256 yang sama pada runner. Finalisasi upload ID yang sama bersifat idempotent: bila branch/run sudah ada, endpoint tidak mengirim workflow kedua. Jalur bridge di atas belum dihubungkan sebagai default frontend pada snapshot ini; jangan menyamakan endpoint tersebut dengan API APKit `/api/upload`, `/api/status`, atau `/api/download`.
