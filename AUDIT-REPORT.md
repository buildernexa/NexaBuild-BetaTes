# NexaBuild — Total Deep Audit & Repair Report

Tanggal: 3 November 2026  
Source awal: `NexaBuild-Mobile-Neo.zip`  
Konfigurasi awal: `NexaBuild-build-audit-rapi.yml` (byte-identik dengan `.github/workflows/build.yml`)

## Ringkasan hasil

Project diperiksa pada frontend standalone, JavaScript, CSS, endpoint API, helper GitHub, workflow Actions, ZIP validation, Android configuration, upload/reassembly, dan test suite. Perbaikan langsung dilakukan pada source. Pemeriksaan otomatis lokal akhir: **36/36 test JavaScript lulus, 11/11 test Python lulus**, `npm run check` lulus, JS syntax check lulus, Python compile check lulus, YAML parse lulus, 10 blok Bash workflow lulus `bash -n`, HTML berisi 243 ID tanpa duplikasi, dan CSS lulus parser `tinycss2` (395 aturan tingkat atas tanpa parse error).

**APK nyata belum dibangun pada lingkungan audit ini.** Lingkungan ini tidak menyediakan Android SDK, `sdkmanager`, Gradle/Gradle wrapper siap pakai, `apksigner`, ADB, atau emulator yang terpasang. Repository GitHub pemilik, akses token, dan Actions runner juga tidak tersedia untuk dispatch. Karena itu tidak ada APK final yang disertakan dan tidak ada klaim instalasi/perangkat yang dibuat.

## Temuan sebelum perbaikan

1. Upload GitHub Actions sebelumnya menyusun ZIP dengan mengurutkan `part-*.bin`, lalu menggabungkan tanpa manifest atau checksum arsip asli. Perubahan chunk dapat tidak terdeteksi sampai tahap ekstraksi/build.
2. Klasifikasi project membaca `package.json` sebagai Web/JavaScript sebelum React Native diperiksa, sehingga deteksi RN bisa tidak pernah tercapai.
3. Workflow website dapat memilih file `index.html` dari ZIP yang mengandung marker project native; hal itu berisiko membungkus source Flutter/Android/React Native secara keliru.
4. Workflow hanya memanggil `apksigner verify`; metadata package/version, permission, launcher icon, dan struktur dasar APK belum diperiksa otomatis.
5. Persetujuan SDK license dimask dengan `|| true`, sehingga kegagalan license dapat tertutup.
6. Terminal menunjukkan progres workflow dengan formula berdasarkan jumlah step plus kenaikan saat menunggu/polling, bukan hanya step aktual yang dilaporkan GitHub.
7. Theme default dashboard adalah Neobrutalism; preset Liquid Glass memakai latar gelap dan blur pada beberapa panel, tidak sesuai brief Clear Glass.
8. API bridge lokal dan APKit eksternal memiliki kontrak berbeda; health API lokal tidak mengembalikan `ok:true` yang diminta adapter APKit lama. Download bridge lokal juga belum memakai helper signature yang sudah tersedia.
9. Status job bridge lokal dapat menyebut antrian untuk UUID sembarang walaupun upload branch tidak ada.

## Perbaikan yang diterapkan

- Menambah `scripts/reassemble_upload.py`: validasi UUID, ukuran 1–40 MiB, SHA-256, jumlah chunk, metadata manifest, urutan, nama, file biasa, ukuran per chunk, jumlah file aktual, dan checksum setelah gabung. File output lama dibersihkan sebelum validasi agar kegagalan tidak meninggalkan arsip stale.
- Browser menghitung SHA-256 dan mengirim manifest upload ke GitHub; workflow menerima `archive_size`, `archive_sha256`, dan `chunk_count`; backend API finalize memakai manifest/kontrak input serupa.
- Perbaikan deteksi React Native/Expo dengan inspeksi dependency `package.json` sebelum klasifikasi Web/JavaScript.
- Menolak ZIP Flutter, Android/Gradle, dan React Native/Expo pada static-web workflow dengan pesan eksplisit. Workflow utama hanya menerima hasil website statis yang benar-benar didukung.
- Menambah `scripts/verify_apk.py`: memanggil `apksigner`, `aapt dump badging`, `aapt dump permissions`, dan `aapt list` untuk memverifikasi signature, package ID, versi, version code, permission yang diminta, manifest, dex, resource table, dan launcher icon. Workflow menjalankannya sebelum publish.
- Menghapus masking kegagalan Android SDK license; workflow memastikan Gradle wrapper ada dan executable; build type disimpan dan dicantumkan pada Release notes.
- Terminal GitHub Actions sekarang menghitung kemajuan dari jumlah step selesai/total yang dikembalikan Actions, menampilkan durasi step nyata, stage aktual, size/file count, checksum, tipe APK, ukuran APK, waktu total, dan estimasi awal/tersisa. Ketika runner belum muncul atau status API gagal, UI menampilkan status tunggu/retry tanpa progres buatan.
- Tema default menjadi Clear Glass terang dengan transparansi panel yang jelas, border putih tipis, aksen lemon-lime, teks kontras, shadow lembut, serta tanpa backdrop blur global. Tema Neobrutalism dipertahankan sebagai alternatif. Ditambah panel estimasi APK.
- API health mengembalikan `ok` dan `ready`; unduhan bridge memerlukan URL HMAC singkat; status UUID yang tidak memiliki branch upload tidak lagi dianggap queued; finalisasi branch menangani respons timeout secara idempotent dan mencegah workflow ganda.
- Sinkronisasi ulang CSS/JS inline pada `index.html` dengan canonical `assets/style.css`, `assets/app.js`, dan `assets/nexa-revision.js`.
- Menambahkan `tests/api.test.js` untuk memanggil handler health, upload chunk, finalisasi upload, status job, dan download dengan request/response tiruan. Test memeriksa method, autentikasi, payload/ID, ukuran ZIP, metadata, dan signature yang invalid tanpa membuat panggilan ke GitHub sungguhan.
- README dan `ENGINE-API.md` diperbarui agar tidak mengklaim native project dibuild oleh workflow website dan agar membedakan APKit eksternal dengan Vercel bridge lokal.

## Jenis project yang didukung

| Jenis | Workflow utama | Catatan |
|---|---|---|
| HTML/CSS/JavaScript statis | Didukung | Harus memiliki `index.html`. |
| Website statis hasil build | Didukung | Output `dist/`, `build/`, `www/`, atau `out/`; termasuk pola Angular browser output. |
| Vite / React / Vue / Angular source | Tidak dieksekusi | Upload hasil compile/export, bukan source yang memerlukan build npm di runner. |
| Android/Gradle native | Ditolak oleh jalur website | Memerlukan engine Android native terpisah. |
| Flutter / Flutter Web project dengan metadata native | Ditolak oleh jalur website | Untuk web, unggah export `build/web` saja tanpa metadata project native. |
| React Native / Expo | Ditolak oleh jalur website | Memerlukan runner React Native khusus. |

Engine APKit eksternal lama tetap dikonfigurasi sebagai fallback untuk project non-static, tetapi kemampuannya tidak diverifikasi di audit ini. API Vercel lokal merupakan bridge terpisah dan tidak otomatis menjadi jalur default frontend.

## Daftar file yang diubah

- `.github/workflows/build.yml`
- `index.html`
- `assets/app.js`
- `assets/nexa-revision.js`
- `assets/style.css`
- `api/health.js`
- `api/upload/finalize.js`
- `api/jobs/[id].js`
- `api/jobs/[id]/apk.js`
- `scripts/prepare_site.py`
- `scripts/reassemble_upload.py` (baru)
- `scripts/verify_apk.py` (baru)
- `tests/nexabuild.test.js`
- `tests/api.test.js` (baru)
- `tests/test_android_config.py`
- `README.md`
- `ENGINE-API.md`
- `AUDIT-REPORT.md`

## Hasil pengujian lokal

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| JavaScript tests | PASS | `node --test`: 36/36 lulus, termasuk 4 test batas endpoint HTTP. |
| Python tests | PASS | `unittest`: 11/11 lulus. |
| Backend API syntax | PASS | `npm run check` lulus untuk seluruh handler/helper. |
| Backend API boundary | PASS (mock request/response) | 4 test untuk method, auth, validasi ID/payload/ukuran, checksum metadata, serta signature download; GitHub API tidak dipanggil. |
| Frontend JavaScript syntax | PASS | `node --check assets/app.js`, `assets/nexa-revision.js`; inline scripts juga diparse dalam tes. |
| Python syntax | PASS | `python3 -m py_compile scripts/*.py tests/*.py`. |
| HTML structure/IDs | PASS (static) | HTML parser menelusuri 243 ID; tidak ada ID duplikat. Tes juga memeriksa inline script dan referensi DOM. |
| CSS parsing | PASS (static) | `tinycss2`: 395 aturan tingkat atas, tanpa parse error. |
| YAML workflow | PASS | YAML berhasil diparse dengan loader yang mempertahankan key `on` GitHub Actions; 15 step terdeteksi. |
| Bash workflow | PASS | Semua 10 blok `run:` diekstrak dan lulus `bash -n`. |
| ZIP security / static site | PASS | Tes traversal, duplicate path, source framework, native project, sample static site; reassembly checksum positif/negatif. |
| APK verifier logic | PASS (mock tools) | Uji logika dengan stub `aapt`/`apksigner`; bukan APK Android nyata. |
| Dependency declaration | PASS (metadata resmi) | `@capacitor/core`, `@capacitor/android`, dan `@capacitor/cli` dipin 8.6.0; Node 22 dan Android API 36 cocok dengan persyaratan Capacitor 8. Instalasi npm aktual tetap NOT TESTED. |
| Capacitor integration | NOT TESTED | Harus mengunduh Capacitor/npm packages dan SDK pada runner. |
| Gradle compilation | NOT TESTED | Gradle/Android SDK tidak tersedia lokal; belum dijalankan di Actions runner. |
| APK signature nyata | NOT TESTED | Belum ada APK keluaran runner. |
| APK metadata nyata | NOT TESTED | Belum ada APK untuk diperiksa `aapt`. |
| APK installation/emulator | NOT TESTED | ADB/emulator tidak tersedia. |
| Browser responsive smoke | NOT TESTED | Upaya Chromium headless pada container berakhir timeout; responsive layout hanya diperiksa lewat CSS/DOM dan test statis, bukan perangkat/browser nyata. |
| GitHub Actions live run | NOT TESTED | Tidak ada repository credentials/dispatch. |
| APKit external build | NOT TESTED | Service eksternal tidak dikendalikan repository dan tidak diverifikasi pada audit ini. |

## Catatan akhir yang penting

- Hasil ini adalah source final yang telah diperbaiki dan melewati tes lokal di atas, bukan bukti bahwa layanan GitHub/Gradle/Android runner milik pengguna telah berhasil menjalankan build.
- Ketika workflow pertama dijalankan pada repository yang sudah diperbarui, bila muncul error tahap environment/Capacitor/Gradle atau hasil APK, log aktual runner tetap perlu diperiksa. Tidak ada cara yang jujur untuk menguji instalasi sebelum APK nyata terbentuk.
- Workflow menggunakan Node 22 (Capacitor saat ini memerlukan Node 22 atau lebih baru) dan Android API 36 (jalur Capacitor 8 menargetkan API 36). Versi Capacitor 8.6.0 tersedia pada registry npm saat audit; namun pengunduhan/kompilasi paket belum dapat dijalankan tanpa Android runner.
- Agar release APK bertanda tangan, keempat GitHub Actions secrets `NEXABUILD_KEYSTORE_BASE64`, `NEXABUILD_KEYSTORE_PASSWORD`, `NEXABUILD_KEY_ALIAS`, dan `NEXABUILD_KEY_PASSWORD` harus disetel lengkap. Bila semuanya kosong, workflow menghasilkan APK debug yang terverifikasi, bukan release-signed.


## Rujukan kompatibilitas toolchain

- [Capacitor Environment Setup](https://capacitorjs.com/docs/getting-started/environment-setup) — persyaratan Node 22+ dan Android SDK.
- [Capacitor Android Target SDK Matrix](https://next.capacitorjs.com/docs/next/android/setting-target-sdk) — Capacitor Android 8.x menggunakan target SDK 36.
- [NPM @capacitor/core 8.6.0](https://www.npmjs.com/package/@capacitor/core), [@capacitor/android 8.6.0](https://www.npmjs.com/package/@capacitor/android), dan [@capacitor/cli 8.6.0](https://www.npmjs.com/package/@capacitor/cli).
