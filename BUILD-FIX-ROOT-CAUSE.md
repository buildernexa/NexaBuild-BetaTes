# NexaBuild — laporan perbaikan kegagalan build

Tanggal pemeriksaan: 3 November 2026
Status: source diperbaiki dan tes lokal lulus; build APK nyata masih menunggu eksekusi GitHub Actions setelah source ini diunggah.

## 1. Bukti kegagalan yang dilaporkan

Dari video log GitHub Actions dan tangkapan layar, job berhenti pada step `Create Capacitor Android wrapper`. Pesan yang muncul:

```text
[error] Could not find installation of TypeScript.
To use capacitor.config.ts files, you must install TypeScript
in your project, e.g. w/ npm install -D typescript
Error: Process completed with exit code 1.
```

Ini adalah kegagalan sebelum kompilasi Gradle dimulai. Karena step wrapper gagal, konfigurasi Android, kompilasi APK, verifikasi APK, dan publikasi APK tidak dijalankan.

## 2. Akar masalah

Skrip build membuat konfigurasi Capacitor berbentuk `capacitor.config.ts`, sementara project wrapper temporer memasang `@capacitor/core`, `@capacitor/android`, dan `@capacitor/cli` tanpa memasang `typescript` sebagai dependency project.

Kode CLI Capacitor mencari `capacitor.config.ts` terlebih dahulu. Jika file tersebut ada, CLI memerlukan paket TypeScript di project. CLI juga mendukung `capacitor.config.json`, yang dibaca sebagai JSON ketika file `.ts` dan `.js` tidak ada. Rujukan implementasi: https://github.com/ionic-team/capacitor/blob/main/cli/src/config.ts (lihat `loadExtConfigTS` dan `loadExtConfig`).

## 3. Perbaikan yang diterapkan

1. Menambahkan `scripts/write_capacitor_config.py` untuk menghasilkan `capacitor.config.json` yang tervalidasi.
2. Workflow membuat folder wrapper baru yang bersih, menyalin website hasil persiapan ke `www/`, lalu menulis konfigurasi JSON.
3. Workflow memastikan file `capacitor.config.json` ada dan `capacitor.config.ts` tidak ada sebelum menjalankan `npx cap add android`.
4. Workflow memeriksa kembali `appId`, `appName`, dan `webDir` dari JSON sebelum memanggil Capacitor.
5. `npx cap add android` dan `npx cap sync android` kini menjadi step wrapper yang eksplisit. Kegagalan keduanya akan tercatat pada step ini, bukan disamarkan sebagai kegagalan Gradle.
6. Workflow memisahkan konfigurasi identitas/ikon Android, kompilasi Gradle, dan verifikasi APK menjadi step tersendiri.
7. Workflow menjalankan `npm run check` dan `npm test` sebagai preflight sebelum pembuatan wrapper.
8. Timeout maksimum satu job dinaikkan dari 30 menjadi 45 menit untuk mengurangi kegagalan karena build cold-runner yang lambat. Ini bukan jaminan bahwa runner tidak akan timeout.

## 4. Perbaikan kesalahan status terminal

Tampilan sebelumnya dapat memperlihatkan 21/21 dan progress 100% walaupun workflow gagal. Sumber masalahnya:

- `failure` dari GitHub belum selalu dinormalisasi ke status UI `failed`.
- Step yang `skipped` dan post-job/cleanup dapat ikut dihitung seolah-olah sukses.
- Ketika nama step cleanup tidak cocok dengan mapping, UI dapat kembali menandai baris pertama sebagai aktif.
- Halaman dapat menampilkan teks permintaan gagal/belum dimulai, padahal GitHub Actions benar-benar berjalan lalu gagal.

Perbaikan:

- Menormalkan `failure`, `timed_out`, `action_required`, dan `startup_failure` sebagai kegagalan.
- Mengeluarkan step `skipped` dan post-action cleanup dari pembilang progres.
- Memetakan nama step aktual ke sembilan tahap dashboard.
- Memprioritaskan step build yang benar-benar gagal.
- Menahan progres di bawah 100% bila status akhir bukan sukses.
- Menghindari asumsi bahwa `Create Capacitor Android wrapper` selalu step yang gagal.
- Menampilkan tautan ke workflow Actions jika run URL tersedia.

## 5. Konsistensi GitHub Pages

GitHub Pages hanya menyajikan file statis. Dashboard yang digunakan Pages adalah `index.html`; karena itu HTML tersebut harus memuat salinan terkini CSS dan JavaScript. Tes parity memastikan empat bagian inline—CSS, workflow-state, app, dan revision—identik dengan file di `assets/`.

Folder `api/` tetap ada sebagai source untuk server runtimes lain, tetapi GitHub Pages tidak menjalankan endpoint server-side dari folder tersebut. Jalur build utama di sini adalah browser → GitHub API → workflow GitHub Actions → runner Android → APK → GitHub Release.

## 6. Hasil tes lokal

- `npm run check`: PASS.
- JavaScript unit/API tests: 40 PASS, 0 FAIL.
- Python tests: 14 PASS, 0 FAIL.
- Python bytecode compile: PASS.
- JavaScript syntax check untuk file `.js`: PASS.
- YAML parse: PASS, 18 workflow steps.
- Bash syntax: PASS, 13 blok `run`.
- Python heredoc di workflow: PASS, 1 blok.
- JSON parse: PASS, 5 file.
- CSS parser: PASS, 395 aturan tingkat atas, 0 parse error.
- HTML structural parse: PASS, 245 ID unik, 4 tag script seimbang.
- Sinkronisasi HTML inline dengan aset: PASS.
- ZIP sample website diuji melalui test suite: PASS.

Log terperinci tersedia pada `NexaBuild-Fix-Checks.txt`.

## 7. Pengujian yang belum dapat dinyatakan lulus

- GitHub Actions nyata setelah patch: NOT RUN. Koneksi GitHub yang tersedia untuk sesi ini menolak akses API dengan HTTP 403 `account suspended`, sehingga saya tidak dapat melakukan push ke repository atau memulai workflow dari sini.
- Kompilasi Gradle nyata: NOT TESTED. Lingkungan audit mempunyai OpenJDK 21, tetapi tidak mempunyai Android SDK/sdkmanager dan Gradle wrapper project belum dihasilkan.
- Apksigner dan inspeksi metadata APK nyata: NOT TESTED. `apksigner`, ADB, dan emulator tidak tersedia.
- Instalasi dan pembukaan APK pada Android: NOT TESTED.
- Chromium headless smoke test: NOT TESTED. Proses Chromium tidak menyelesaikan rendering/dump DOM dalam batas waktu lingkungan ini; validasi HTML/CSS statis tetap lulus.

Karena pemeriksaan di atas belum dilakukan, laporan ini tidak menyatakan APK sudah berhasil dibuat, bisa dipasang, atau bebas kendala.

## 8. File utama yang berubah pada revisi ini

- `.github/workflows/build.yml`
- `scripts/write_capacitor_config.py`
- `assets/workflow-state.js`
- `assets/nexa-revision.js`
- `assets/app.js`
- `index.html`
- `tests/nexabuild.test.js`
- `README.md`
- `BUILD-FIX-ROOT-CAUSE.md`

## 9. Langkah setelah source diunggah

1. Timpa source repository GitHub Pages dengan isi ZIP perbaikan ini, jangan menaruh folder proyek satu tingkat di bawah root.
2. Pertahankan `.github/workflows/build.yml` pada branch utama.
3. Tunggu deployment Pages selesai dan lakukan refresh tanpa cache pada browser Android.
4. Buka tab Actions dan pastikan workflow terbaru memakai `capacitor.config.json`.
5. Jalankan satu build sample. Jika gagal lagi, ambil log step pertama yang berstatus `failure`; itu adalah bukti baru untuk audit berikutnya.
6. Nyatakan APK berhasil hanya jika workflow berakhir `success`, asset APK ada di Release, verifier signature/metadata lulus, dan APK berhasil diinstal/dibuka pada perangkat atau emulator.
