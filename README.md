# NEXA STUDIO — Clear Glass Mobile Dashboard

Dashboard menggunakan tema Clear Glass sebagai default: panel putih transparan dengan border kaca tipis, aksen lemon-lime, teks kontras, bayangan lembut, tanpa blur menyeluruh, navigasi kapsul, dan layout khusus ponsel. Tema Neobrutalism Soft tetap tersedia sebagai alternatif. Fungsi Home, Build, History, GlobalChat, Quran, preview ZIP, import GitHub, API, serta GitHub Actions tetap dipertahankan.

## Buka aplikasi

**Pilihan paling mudah untuk melihat dashboard:** buka `index.html` di Chrome. File utama ini sudah menyematkan CSS, JavaScript dashboard, dan JSZip di dalam HTML sehingga tata letak dan ikon tidak hilang ketika file HTML dibuka langsung dari folder Download Android.

**Untuk menjalankan semua fitur repository dan build:** ekstrak seluruh ZIP ini ke satu folder atau unggah seluruh isinya ke repository GitHub. Pertahankan folder `assets/`, `.github/`, `api/`, `lib/`, `scripts/`, `community/`, dan `builds.json`. Jangan memisahkan `index.html` dari folder proyek saat mengunggah ke hosting.

> Bila hanya `index.html` yang dibagikan, antarmuka tetap tampil. Namun file video default `assets/videos/*.mp4`, API server `/api/*`, dan konten proyek pendamping hanya tersedia ketika folder proyek lengkap ikut dihosting/diekstrak. Slot video yang belum ada menampilkan fallback bertema NexaBuild.

## Koneksi GitHub

1. Buka gerbang sidik jari dan hubungkan GitHub pada layar masuk atau melalui Settings.
2. Isi **Token**, **Owner/Username**, dan **Nama Repo** pada kolom masing-masing. Dashboard memvalidasi token melalui `GET /user` dan memvalidasi akses repository sebelum menyimpan koneksi.
3. Token disimpan pada `localStorage` perangkat ini. Gunakan perangkat pribadi, jangan membagikan token, dan cabut token dari GitHub bila perangkat tidak lagi dipercaya.
4. Untuk build langsung, token perlu izin repository yang memadai: **Contents: Read and write**, **Actions: Read and write**; gunakan **Issues: Read and write** jika GlobalChat dipakai. Profil pengguna dibaca dari endpoint GitHub `/user`.
5. Pastikan Actions diaktifkan pada repository. Workflow yang digunakan adalah `.github/workflows/build.yml`.

## Hosting GitHub Pages (tanpa Vercel)

NexaBuild dapat di-host sebagai website statis melalui GitHub Pages. Pada repository, buka **Settings → Pages → Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/(root)`, lalu simpan. Pastikan `index.html` berada langsung di root repository bersama folder `assets/`, `scripts/`, `.github/`, dan `builds.json`. URL project Pages biasanya berbentuk `https://OWNER.github.io/REPOSITORY/`.

GitHub Pages hanya menyajikan HTML, CSS, JavaScript, dan aset statis. Folder `api/` pada repository ini **tidak dijalankan** sebagai server API oleh Pages. Jalur build utama untuk website statis adalah JavaScript dashboard → GitHub REST API (token pengguna) → workflow `.github/workflows/build.yml` → runner GitHub Actions → APK diverifikasi → GitHub Release. Karena itu, jangan memakai URL `/api/*` pada domain Pages sebagai backend.

Gunakan Fine-grained Personal Access Token yang dibatasi ke repository builder dengan **Contents: Read and write** dan **Actions: Read and write**. Simpan token hanya di browser pribadi melalui formulir koneksi dashboard; jangan commit token atau secret ke repository, dan cabut token jika perangkat/browser tidak lagi dipercaya. Repository Pages publik diperlukan pada GitHub Free; Pages privat membutuhkan paket yang mendukungnya.

## Perbaikan kegagalan Capacitor Android wrapper

Insiden build yang dilaporkan pada 3 November 2026 berhenti di step `Create Capacitor Android wrapper`, sebelum kompilasi Gradle. Log runner menunjukkan `Could not find installation of TypeScript` karena konfigurasi Capacitor berbentuk `capacitor.config.ts` sementara dependency TypeScript tidak terpasang. Workflow yang diperbaiki sekarang menghasilkan `capacitor.config.json`, memverifikasi nilai app ID/nama/webDir, memastikan file `.ts` tidak ada, lalu menjalankan `npx cap add android` dan `npx cap sync android`. Ini menghapus kebutuhan TypeScript untuk konfigurasi tersebut.

Perbaikan status terminal: kesimpulan GitHub `failure` dinormalisasi menjadi `failed`; step `skipped` dan post-action cleanup tidak dihitung sebagai progres sukses; kegagalan dipetakan ke stage yang sesuai; workflow yang gagal tidak lagi ditampilkan sebagai “belum dimulai”. Baris terminal menggunakan nama step aktual dari GitHub Actions. Workflow juga menjalankan preflight `npm run check` dan `npm test` sebelum setup wrapper/Gradle.

Setelah memperbarui repository, tunggu GitHub Pages selesai deploy ulang, refresh halaman dengan cache dibersihkan, lalu jalankan build percobaan. Jika gagal lagi, buka URL Actions pada pesan error dan periksa step pertama berstatus `failure`; perbaikan konfigurasi TypeScript ini tidak dapat menjamin semua kemungkinan kegagalan jaringan, perubahan runner, dependency, atau konfigurasi Android sudah hilang. APK baru dinyatakan berhasil setelah workflow selesai sukses, signature/metadata terverifikasi, dan asset APK tersedia di Release.

## Build APK

1. Buka Build, pilih ZIP project, lalu tekan Preview Project.
2. Periksa preview. Lengkapi nama aplikasi, Application ID, versi, version code, dan ikon bila perlu.
3. Atur Mode Internet, Kamera, Wake Lock, dan Getaran sesuai kebutuhan aplikasi.
4. Tekan Build APK. Dashboard menghitung perkiraan waktu berdasarkan ukuran arsip, jumlah file, dan median build sukses lokal bila sudah tersedia. Perkiraan bukan jaminan waktu selesai; antrean GitHub dan kondisi runner tidak bisa diprediksi.
5. Untuk jalur GitHub Actions, file ZIP diunggah sebagai chunk Git objects. Browser mengirim manifest ukuran/jumlah chunk/SHA-256; runner memeriksa ulang urutan, jumlah, ukuran, dan checksum sebelum ekstraksi. Workflow kemudian menyiapkan Capacitor Android, konfigurasi, ikon, Gradle, verifikasi APK, dan GitHub Release.
6. Terminal menampilkan status runner dan nama step aktual. Durasi step dihitung dari `started_at` dan `completed_at` yang diberikan GitHub Actions. Saat runner masih antre atau status API terputus, dashboard menampilkan status menunggu/ulang koneksi, bukan menaikkan persentase palsu.
7. Unduhan baru diaktifkan setelah Release API mengembalikan asset APK nonkosong. Dashboard menampilkan ukuran, tipe `debug` atau `release-signed` (jika metadata Release tersedia), dan durasi keseluruhan.

### Jenis project yang benar-benar diproses workflow utama

Workflow utama menggunakan Capacitor untuk **hasil website statis**, bukan compiler universal. HTML/CSS/JavaScript statis diterima. Untuk source framework, unggah hasil export/compile: Vite/Vue/React umumnya `dist/` atau `build/`, Next static export `out/`, dan Angular dapat memakai `dist/<nama-app>/browser/`. Preview dan workflow memilih output website yang sama. Workflow tidak menjalankan `npm install` atau script milik ZIP project pengguna.

Source Flutter, Android/Gradle, dan React Native/Expo **tidak dikompilasi oleh workflow website ini**. ZIP yang mengandung metadata native akan ditolak oleh pemeriksa workflow, sehingga tidak salah dibungkus sebagai web app. Untuk jenis tersebut, dashboard hanya meneruskannya ke engine eksternal lama apabila dipilih; kemampuan dan hasil APK dari layanan eksternal itu tidak diverifikasi oleh source repository ini.

Batas arsip workflow: 40 MiB compressed upload, 10.000 file, total 160 MiB setelah ekstrak, 80 MiB per file, rasio kompresi maksimum 500:1. ZIP terenkripsi, path traversal, path duplikat case-insensitive, symbolic link, dan file khusus ditolak.

### Jalur build yang tersedia

- **GitHub Actions langsung:** jalur utama untuk website statis ketika repository GitHub terhubung. Butuh token dengan izin Contents dan Actions yang sesuai.
- **APKit eksternal (default engine lama):** API pihak ketiga yang dikonfigurasi terpisah pada pengaturan engine. Kontrak ringkasnya ada di `ENGINE-API.md`; availability dan kemampuan build saat ini tidak dijamin oleh proyek ini.
- **Vercel API bridge lokal:** endpoint `api/` pada repository ini merupakan bridge server-side terpisah yang membutuhkan environment variables dan access key. Endpoint ini bukan endpoint APKit, dan dashboard versi ini tidak otomatis menggunakannya sebagai jalur default. Kontraknya ada di `ENGINE-API.md`.

### Signing APK

Tanpa keystore, workflow menghasilkan APK debug untuk pengujian. Untuk signed release, atur empat **Repository Actions secrets** berikut:

- `NEXABUILD_KEYSTORE_BASE64`
- `NEXABUILD_KEYSTORE_PASSWORD`
- `NEXABUILD_KEY_ALIAS`
- `NEXABUILD_KEY_PASSWORD`

Menu Settings → Setup Keystore membantu membaca file keystore dan menyiapkan Base64. Nilai Base64 serta password tetap harus dimasukkan secara aman ke halaman Secrets GitHub. Jangan commit `.jks`, alias rahasia, atau password ke repository.

## File video yang disiapkan manual

Upload MP4 ke `assets/videos/` dengan nama persis berikut:

| Nama file | Dipakai untuk |
|---|---|
| `intro.mp4` | Intro fullscreen setelah koneksi GitHub pertama |
| `liquidglass-bg.mp4 (opsional)` | Background video tema Clear Glass |
| `anime-1.mp4` | Video Build pool 1 |
| `anime-2.mp4` | Video Build pool 2 |
| `anime-3.mp4` | Video Build pool 3 |

Pilih video dan upload pool pengganti melalui **Settings → Kustomisasi Dashboard**. File pilihan pengguna disimpan lokal di IndexedDB perangkat. Pilihan font Google Fonts atau upload font lokal ada di bagian Settings yang sama. File video yang belum diunggah menampilkan placeholder, bukan ikon media rusak.

File `assets/anime-loop.mp4` adalah video bawaan lama untuk area Home. Rekaman layar yang pernah dikirim untuk melaporkan masalah tampilan tidak disertakan sebagai video latar.

## Data bersama dan GlobalChat

- `community/members.json`: daftar username unik yang pernah terhubung.
- `community/presence.json`: heartbeat user; client mengirim pembaruan tiap 2 menit selama halaman terlihat, dan entri dianggap aktif selama 10 menit terakhir.
- `builds.json`: riwayat build bersama, termasuk `iconDataUrl` base64 per build. Histori lokal juga disimpan di browser.
- GlobalChat menggunakan komentar pada GitHub Issue yang nomor Issue-nya diatur melalui Settings → Chat Config. Agar semua orang berada di satu ruang global, seluruh pengguna harus menghubungkan Owner/Repo yang sama dan memakai nomor Issue yang sama; repository atau Issue berbeda berarti ruang chat berbeda. Avatar dan username berasal dari akun GitHub pengirim. Lampiran foto/file dan stiker memerlukan izin Contents untuk menyimpan berkas komunitas.

## Catatan autentikasi dan batas platform

Gerbang sidik jari adalah interaksi tekan-tahan lokal 1,8 detik, bukan verifikasi biometrik perangkat Android. Token GitHub menjadi identitas akun NexaBuild. Autoplay bersuara dapat dibatasi browser; bila gesture pertama tidak mengizinkan audio, tombol suara manual tetap tersedia.

## Pemeriksaan lokal

Jalankan `npm run check` untuk pemeriksaan sintaks endpoint/server dan `npm test` untuk tes JavaScript, batas endpoint API, ZIP, reassembly/checksum, deteksi tipe project, konfigurasi Android, pemeriksa APK, dan cache offline. Pemeriksaan lokal tidak menggantikan build APK nyata di GitHub Actions, verifikasi instalasi emulator, atau pengujian di perangkat Android.
