# Telegram AI Gateway

> Dokumentasi ini dalam bahasa Indonesia. Versi bahasa Inggris ada di [README.md](./README.md).
> **Antarmuka dashboard-nya sendiri tetap berbahasa Inggris** — semua label, tombol, dan
> status di layar sengaja dibiarkan dalam bahasa Inggris agar konsisten dengan isi
> database, nama kolom, dan istilah teknis di kode.

Konsol operasi satu pengguna untuk gateway Telegram ⇄ AI pribadi.

Sebuah fungsi serverless di Vercel menerima update webhook dari Telegram,
memeriksa chat terhadap allowlist tiga slot, meneruskan pesan melalui rantai
provider AI yang berurutan dengan retry dan fallback otomatis, mengirim balasan
kembali ke Telegram, serta merekam setiap langkah yang terjadi agar bisa dibaca
nanti.

Semuanya dikonfigurasi dari dashboard. Menambah provider, mengubah chat id, atau
mengurutkan ulang rantai fallback tidak pernah memerlukan redeploy atau edit
environment.

---

## Daftar isi

- [Apa yang dikerjakan](#apa-yang-dikerjakan)
- [Arsitektur](#arsitektur)
- [Mulai cepat](#mulai-cepat)
- [Setup Turso](#setup-turso)
- [Deploy ke Vercel](#deploy-ke-vercel)
- [Menghubungkan Telegram](#menghubungkan-telegram)
- [Mengonfigurasi provider](#mengonfigurasi-provider)
- [Cara kerja routing, retry, dan fallback](#cara-kerja-routing-retry-dan-fallback)
- [Request trace](#request-trace)
- [Model data](#model-data)
- [Model keamanan](#model-keamanan)
- [Skrip](#skrip)
- [Pengujian](#pengujian)
- [Desain](#desain)
- [Troubleshooting](#troubleshooting)

---

## Apa yang dikerjakan

| | |
|---|---|
| **Menerima** | Update `message`, `edited_message`, dan `channel_post` dari Telegram di `POST /api/telegram/webhook` |
| **Mengizinkan** | Tepat tiga slot chat id. Selebihnya ditolak, dan opsional dibalas dengan pemberitahuan |
| **Mengarah** | Rantai provider berurutan, masing-masing dipanggil berdasarkan **id** — tidak pernah berdasarkan posisi array |
| **Turun SERVO dengan baik** | Retry kegagalan sementara di tempat yang sama, fallback saat kegagalan keras, dan menolak membuang rantai saat request ditolak |
| **Menjawab** | Membelah balasan panjang di batas paragraf, jadi Telegram tidak pernah memotong |
| **Merekam** | Setiap pesan, setiap percobaan provider, setiap event request, setiap baris log |
| **Menjelaskan** | Timeline per-request yang bisa dibaca seperti console log |

---

## Arsitektur

```
Telegram  ──POST──▶  /api/telegram/webhook            (Vercel serverless, Node)
                          │
                          ├─ 1. validasi bentuk update
                          ├─ 2. klaim update_id          ← gerbang idempotensi
                          ├─ 3. cek allowlist chat
                          ├─ 4. muat percakapan dan riwayatnya
                          ├─ 5. arahkan melalui rantai provider
                          │       ├─ provider A ──retry──▶ provider A
                          │       └─ fallback ──────▶ provider B ──▶ provider C
                          ├─ 6. kirim balasan ke Telegram
                          └─ 7. simpan semuanya
                          ▼
                      Turso (libSQL)
```

**Tanpa long polling.** Telegram yang mendorong ke webhook; fungsinya menjawab lalu selesai.

**Tanpa sumber kebenaran di memori.** Satu-satunya state di dalam proses adalah
koneksi database yang di-cache per instance yang hangat. Selebihnya hidup di
Turso, sehingga dashboard dan webhook selalu sepakat dan instance baru yang
dingin tidak kehilangan apa pun.

**Migration berjalan sekali, bukan per request.** Skema diterapkan oleh
`npm run db:migrate` saat deploy. Jalur request tidak pernah menjalankan
migration.

### Struktur proyek

```
src/
  app/
    (dashboard)/         Overview, Messages, Conversations, Requests, Providers, Logs, Settings
    api/                 webhook receiver, route provider/settings/telegram
  components/
    ui/                  Button, Badge, Panel, Field, Dialog, Toast, Table, Stat
    layout/              Sidebar, Topbar, AppShell
    charts/              diagram batang tanpa dependensi + bar latensi
    timeline/            request trace — bagian inti
    providers/           form dan manajer provider
    settings/            bagian conversation, telegram, dan appearance
  lib/
    db/                  skema Drizzle, migration, seed, seed demo
    providers/           registry adapter, HTTP, router (retry + fallback)
    telegram/            validasi update dan klien Bot API
    gateway.ts           pipeline webhook
    crypto.ts            AES-256-GCM untuk data-at-rest
    sanitize.ts          pembersihan kredensial
  *.test.ts              unit test
scripts/
  smoke.ts               uji reliability end-to-end
  audit.mjs              sapuan responsif/kontras/aksesibilitas
  shoot.mjs              pengambilan screenshot
```

---

## Mulai cepat

Membutuhkan **Node 20+**.

```bash
git clone <repo-kamu> telegram-ai-gateway
cd telegram-ai-gateway
npm install

cp .env.example .env.local
# isi DATABASE_URL dan ENCRYPTION_KEY (lihat di bawah)

npm run db:migrate      # buat skema
npm run db:seed         # opsional: tulis baris pengaturan default
npm run dev             # http://localhost:3000
```

Untuk kerja lokal tanpa Turso, arahkan ke berkas SQLite — aplikasinya memakai
driver yang sama, jadi tidak ada yang perlu diubah:

```dotenv
# .env.local
DATABASE_URL=file:./data/gateway.db
ENCRYPTION_KEY=<64 karakter hex>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Buat kunci enkripsi dengan salah satu cara ini:

```bash
openssl rand -hex 32
# atau
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `ENCRYPTION_KEY` bukan rahasia database — itu kunci yang mengenkripsi bot token
> dan setiap provider key saat disimpan. **Mengubahnya membuat nilai yang sudah
> terenkripsi tidak terbaca.** Simpan di password manager sebelum kamu memakai bot
> sungguhan.

Mau lihat dashboard dengan lalu lintas yang realistis? `npm run db:seed:demo`
mengisi database lokal dengan provider contoh, percakapan, pesan, request
beserta riwayat fallback-nya, dan log. Perintah ini menolak jalan kalau
database-nya remote.

---

## Setup Turso

Aplikasi ini bicara libSQL, jadi Turso adalah target produksi dan berkas SQLite
lokal adalah target pengembangan. Drivernya `@libsql/client`, yang merupakan
integrasi resmi Turso untuk Vercel — SQL dikirim lewat HTTP biasa, tanpa native
dependency, dan sepenuhnya didukung Drizzle.

**Buat database lewat dashboard** — ini cara yang paling bisa diandalkan dan
cukup satu menit:

1. Buka [turso.tech/app](https://turso.tech/app) lalu **Sign in with GitHub**.
2. **Create Database**, beri nama `gateway`, pilih region terdekat.
3. Salin **Database URL** yang tampil di halaman database tersebut.
4. Buka **API Tokens**, buat satu, lalu salin **saat itu juga** — nilainya tidak
   ditampilkan lagi.

> Kalau mau memakai CLI, pasang lewat installer resmi Turso
> (`https://get.tur.so/install.sh`, atau skrip Windows yang ada di
> [dokumentasinya](https://docs.turso.tech/cli/installation)), lalu jalankan
> `turso auth login` dan `turso db create gateway`.
> **Jangan pakai `npm install -g turso`** — paket itu berisi SQL shell
> interaktif, bukan management CLI, sehingga `turso db create` diam-diam tidak
> melakukan apa pun.

Lalu isi ini di `.env.local` untuk lokal, dan di proyek Vercel untuk produksi:

```dotenv
TURSO_DATABASE_URL=libsql://gateway-nama-kamu.turso.io
TURSO_AUTH_TOKEN=<token read-write>
ENCRYPTION_KEY=<64 karakter hex>
```

Terapkan skemanya sekali:

```bash
npm run db:migrate
```

`db:migrate` bersifat idempoten — ia melacak migration yang sudah diterapkan di
`__drizzle_migrations`, jadi menjalankannya lagi aman dan tidak melakukan apa pun
pada run kedua.

Periksa datanya kapan saja dengan `npm run db:studio` (Drizzle Studio).

---

## Deploy ke Vercel

1. **Push repository** ke GitHub, GitLab, atau Bitbucket.

2. **Import** ke Vercel. Setelan bawaan sudah benar; tidak perlu konfigurasi build.

3. **Tambahkan environment variable** di *Settings → Environment Variables*,
   tandai masing-masing sebagai **Production**, **Preview**, dan (opsional)
   **Development**:

   | Variable | Wajib | Catatan |
   |---|---|---|
   | `TURSO_DATABASE_URL` | ya | `libsql://…` |
   | `TURSO_AUTH_TOKEN` | ya | token read-write |
   | `ENCRYPTION_KEY` | ya | 64 karakter hex; mengubahnya membuat secret tersimpan tidak terbaca |
   | `NEXT_PUBLIC_APP_URL` | disarankan | mis. `https://gateway.example.com`. Hanya dipakai untuk mendaftarkan webhook; jatuh ke `VERCEL_PROJECT_PRODUCTION_URL`, lalu `VERCEL_URL` |
   | `ADMIN_API_KEY` | opsional | Kalau diisi, route tulis memerlukan header `x-admin-key` yang cocok |

4. **Deploy.** Build pertama menjalankan `next build`; migration *tidak* dijalankan
   otomatis, jadi jalankan sekali dari mesin kamu ke database produksi (lihat di
   bawah).

5. **Terapkan skema ke produksi**, sekali:

   ```bash
   # dari mesin kamu, dengan nilai produksi di .env.local
   npm run db:migrate
   ```

   Atau salin isi `drizzle/0000_init.sql` ke shell Turso
   (`turso db shell <database>`). Berkasnya adalah SQL biasa.

6. Buka deployment-nya dan masuk ke **Settings → Telegram**.

> **Deploy ulang aman.** Migration berversi, dan aplikasi tidak pernah menjalankan
> migration saat ada request. Kamu bisa deploy ulang sewaktu-waktu.

### Tentang admin key

Tidak ada login, tidak ada tabel user, dan tidak ada sistem session — ini alat
personal untuk satu operator, dan brief-nya secara eksplisit melarang sistem
autentikasi penuh. Yang ada sebagai gantinya adalah penjaga sempit pada route
*tulis*:

- Kalau `ADMIN_API_KEY` tidak diisi, dashboard terbuka. Tidak masalah di localhost,
  dan juga tidak masalah di belakang deployment protection Vercel untuk akun privat.
- Kalau diisi, setiap route API yang mengubah data memerlukan header `x-admin-key`
  yang cocok. Dashboard menanyakannya sekali dan menyimpannya **hanya di
  `sessionStorage`** — sengaja bukan `localStorage`, supaya tidak bertahan setelah
  tab ditutup.

Route baca, termasuk seluruh dashboard, tetap terbuka. Kalau kamu butuh
deployment-nya sendiri privat, nyalakan deployment protection Vercel.

---

## Menghubungkan Telegram

1. **Buat bot.** Kirim pesan ke [@BotFather](https://t.me/BotFather) → `/newbot`.
   Salin tokennya. Bentuknya seperti
   `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`.

2. **Tempelkan ke Settings → Telegram → Bot token** lalu simpan. Token dienkripsi
   dengan AES-256-GCM sebelum menyentuh database dan tidak pernah dikembalikan ke
   browser — kolomnya menampilkan mask seperti `1234••••••pass`. Pakai **Test bot
   connection** untuk memverifikasinya.

3. **Cari chat id kamu.** Kirim pesan apa saja ke bot, lalu buka
   `https://api.telegram.org/bot<TOKEN>/getUpdates` dan baca
   `result[].message.chat.id`.

   | Chat | Bentuk id-nya |
   |---|---|
   | Private chat | `555000111` |
   | Grup | `-1001234567890` |
   | Channel | `-1001234567890` |

   Yang ada hanyalah tiga slot **chat id**, bukan id user — di dalam grup, id-nya
   milik grup itu, jadi semua orang di grup yang diizinkan ikut diizinkan.

4. **Isi ketiga slot** lalu simpan. Biarkan satu slot kosong untuk melewati.

5. **Daftarkan webhook.** Klik **Register webhook** di panel yang sama. Dashboard
   memanggil `setWebhook` milik Telegram dengan URL publik deployment kamu
   ditambah `/api/telegram/webhook`.

   Kamu tidak perlu percaya begitu saja pada URL itu: klik **Check status** dan
   aplikasinya membaca `getWebhookInfo` langsung dari Telegram, jadi yang kamu
   lihat adalah pandangan Telegram sendiri, bukan nilai cache.

6. **Kirim pesan ke botmu.** Balasannya sampai di Telegram; request trace yang
   cocok muncul di dashboard bagian **Messages**.

### Perintah

| Perintah | Perilaku |
|---|---|
| `/start`, `/help` | Dijawab secara lokal. Tidak memakai panggilan provider. |
| `/reset` | Menghapus riwayat percakapan untuk chat itu, lalu mengonfirmasi. |

### Kenapa balasannya kadang bilang gateway gagal

Pesan itu muncul karena gateway memilih jujur daripada mengabaikan seseorang.
Pesan ini muncul ketika semua provider di rantai gagal. **Request trace** yang
disebut di dalam pesan adalah cara tercepat untuk melihat provider mana yang
gagal dan alasannya.

---

## Mengonfigurasi provider

Provider ditambahkan sepenuhnya dari **AI Providers**. Tidak ada satu pun
environment variable yang terlibat, dan tidak ada redeploy.

Klik **Add provider**:

| Kolom | Arti |
|---|---|
| **Name** | Ditampilkan di seluruh dashboard. Bebas terserah kamu. |
| **Base URL** | Akar API. Sertakan segmen versi: `https://openrouter.ai/api/v1` |
| **API key** | Disimpan terenkripsi. Yang ditampilkan selanjutnya hanya mask. |
| **Model** | Id model yang diminta. |
| **Adapter** | Bentuk request/response yang dipakai bicara. Lihat di bawah. |
| **Custom headers** | Pasangan `Name: value` opsional, terenkripsi bersama key. |
| **Timeout** | Ditimpa oleh provider timeout global di Settings. |
| **Cost** | Opsional $/1M token input dan output, untuk kolom biaya. |

**Test connection** melakukan putaran HTTP sungguhan dan melaporkan status HTTP,
latensi, dan error yang persisnya, lalu menyimpan hasilnya supaya daftar provider
menampilkan kondisinya sekilas.

### Adapter

| Adapter | Pakai untuk | Contoh Base URL |
|---|---|---|
| `openai-compatible` | Apa pun yang punya endpoint `/chat/completions` — OpenAI, OpenRouter, Groq, Together, DeepSeek, Ollama, LM Studio, vLLM, kebanyakan proxy | `https://api.openai.com/v1` |
| `anthropic` | Anthropic Messages API | `https://api.anthropic.com/v1` |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |
| `custom-http` | Apa pun yang lain. Kamu menyediakan body template dan JSON path menuju teks balasannya | *endpoint kamu* |

`custom-http` adalah JSONPath-lite: arahkan **Response path** ke string yang
kamu mau, misalnya `result.answer` atau `choices.0.text`. **Body template** adalah
template JSON dengan `{{messages}}`, `{{model}}`, `{{temperature}}`, dan
`{{maxTokens}}` yang disubstitusi.

### Mengurutkan rantai

Tanpa drag, dan eksplisit: pakai tombol ↑ / ↓ pada setiap provider. Urutannya
adalah prioritas yang tersimpan, dan router menelusurinya berdasarkan **provider
id**, jadi
mengurutkan ulang tidak mungkin membuat request pergi ke provider yang salah.
Tepat satu provider adalah primary; sisanya fallback sesuai urutan prioritas.
Menonaktifkan provider melepaskannya dari rantai tanpa menghapusnya.

---

## Cara kerja routing, retry, dan fallback

Rantainya: **coba primary → retry kalau kegagalannya bersifat sementara → pindah
ke provider berikutnya → ulangi.**

### Apa yang dihitung sebagai kegagalan, dan apa akibatnya

| Kondisi | Kategori | Retry di tempat? | Fallback? |
|---|---|---|---|
| Timeout / abort | `timeout` | ya | ya |
| Error jaringan, DNS gagal, socket hang-up | `network` | ya | ya |
| `429` | `rate_limit` | ya | ya |
| `5xx` | `server_error` | ya | ya |
| `401`, `403` | `auth` | tidak | ya |
| `404` | `config` | **tidak** | **tidak** |
| `400`, `422`, `4xx` lain | `bad_request` | **tidak** | **tidak** |
| Error yang tidak dikenali | `unknown` | tidak | ya |

Pembedaan yang penting: `400` berarti provider memberi tahu bahwa *request*-nya
yang salah. Mencoba provider lain dengan request yang sama akan gagal dengan cara
yang sama, jadi rantai langsung dihentikan dan anggarannya dihemat. `401` berbeda
— provider lain punya key yang berbeda, jadi layak dicoba.

**Retry di tempat** dibatasi oleh *Retries per provider* di Settings →
Conversation (default `2`, jadi maksimal tiga percobaan masing-masing).
**Fallback** tidak terbatas — dibatasi oleh jumlah provider yang aktif.

### Apa yang direkam untuk setiap percobaan

Nama dan id provider, model, nomor percobaan, waktu mulai, durasi, status HTTP,
hasil, kategori error, dan pesan error yang sudah dibersihkan. Masing-masing
menjadi satu baris di `request_attempts`, dan terlihat di request trace.

### Idempotensi

Telegram mengulang webhook setiap kali tidak mendapat `2xx` dengan cepat, dan
kadang mengirim update yang sama dua kali. Tabel `telegram_updates` menjadikan
`update_id` sebagai **primary key**: gateway menginsert id itu, dan kalau insert
tidak mengklaim apa pun, seluruh pipeline dihentikan. Duplikat hanya memakan satu
`INSERT` yang murah dan tidak menghasilkan balasan kedua, tidak ada panggilan
provider kedua, dan tidak ada baris duplikat.

Webhook menjawab `200` untuk duplikat, body malformed, chat yang ditolak, dan
request yang tertangani — karena mengulang salah satu dari semuanya tidak mengubah
apa pun. Ia menjawab `500` hanya untuk kegagalan tak terduga, dan itu aman tepat
karena ledger update-id membuat pemutaran ulang menjadi no-op kalau percobaan
pertama sudah cukup jauh untuk mengklaimnya.

---

## Request trace

Setiap request mendapat correlation id pendek (`Request #8F3A21`) dan sebuah
timeline:

```
23:41:02.004   Webhook received                update_id 800123
23:41:02.011   Telegram update validated       chat 555000111 · @dana · message 9921
23:41:02.012   Chat authorized                Chat id matched an allowlist slot
23:41:02.014   Conversation loaded             18 messages of history (limit 20)
23:41:02.015   Provider selected               OpenRouter · anthropic/claude-3.5-sonnet
23:41:03.402   AI response received            HTTP 200 · 1387ms · 731 tokens
23:41:03.404   Telegram sendMessage started
23:41:03.611   Telegram delivery successful    message_id 778120
23:41:03.612   Request completed               OpenRouter · 1608ms total
```

Kasus fallback terlihat seperti ini, dan urutannya adalah bagian yang berguna:

```
23:44:10.002   Provider selected               OpenRouter · anthropic/claude-3.5-sonnet
23:44:10.884   Provider returned 429           Rate limit reached
23:44:10.885   Retrying provider               OpenRouter · attempt 2 of 3
23:44:11.701   Provider returned 429           Rate limit reached
23:44:11.702   Retrying provider               OpenRouter · attempt 3 of 3
23:44:12.640   Provider returned 429           Rate limit reached
23:44:12.641   Fallback triggered              OpenRouter failed with HTTP 429. Trying Groq.
23:44:13.502   AI response received            HTTP 200 · 861ms · 512 tokens
23:44:13.503   Telegram delivery successful    message_id 778199
23:44:13.504   Request completed               Groq · 3502ms total · 1 fallback(s)
```

Setiap entri diberi warna menurut levelnya, gutter-nya monospace, dan tiap node
menampilkan delta-nya sendiri, sehingga bentuk request yang lambat langsung
terbaca sekilas.

> Baris `Webhook received` sampai `Request completed` sengaja dipertahankan dalam
> bahasa Inggris karena itu persis string yang disimpan di database dan yang
> muncul di trace — jadi yang kamu baca di sini sama persis dengan yang muncul
> di dashboard.

---

## Model data

| Tabel | Isi |
|---|---|
| `settings` | Tuning key/value: kedalaman riwayat, temperature, max tokens, anggaran retry, provider timeout, tema default |
| `telegram_config` | Baris tunggal: bot token terenkripsi, tiga slot chat id, status webhook, identitas bot |
| `ai_providers` | Provider, key terenkripsi dan custom header-nya, urutan, flag enabled/primary, hasil tes terakhir |
| `conversations` | Satu baris per chat: nama tampilan, jumlah pesan, aktivitas terakhir |
| `messages` | Dua arah, lengkap dengan status, provider, model, latensi, request id |
| `ai_requests` | Satu baris per giliran AI: correlation id, status, provider pemenang, jumlah token, biaya, latensi, error |
| `request_attempts` | Satu baris per panggilan provider di dalam sebuah request |
| `request_events` | Timeline trace, satu baris per langkah |
| `telegram_updates` | Ledger idempotensi. `update_id` adalah primary key |
| `logs` | Log aplikasi terstruktur lintas kategori |

---

## Model keamanan

**Kredensial tidak pernah sampai ke browser.** Bot token dan setiap provider API
key dienkripsi dengan AES-256-GCM (`iv.tag.ciphertext`, base64) sebelum disimpan.
Pembacaan dari API mengembalikan `hasApiKey: true` dan mask seperti
`sk-a••••••mnop`. Tidak ada jalur kode yang mengembalikan secret terdekripsi lewat
HTTP.

**Secret tidak ada di browser sama sekali.** Tidak ada hal sensitif yang ditulis
ke `localStorage` atau `sessionStorage`, dicetak ke console, atau disertakan dalam
pesan error. Satu-satunya pengecualian adalah `ADMIN_API_KEY` opsional, yang
disimpan dashboard hanya di `sessionStorage` — tidak pernah `localStorage`.

**Error dibersihkan sebelum disimpan atau ditampilkan.** Bearer token, pasangan
`api_key: …`, bot token Telegram, `sk-…`, `AIza…`, dan string berbentuk JWT diganti,
baik di teks pesan, header, maupun metadata JSON. Header kredensial dihapus
penuhnya, bukan sekadar disamarkan.

**Rel pengaman di dalam codebase.** Modul yang memegang secret atau menyentuh
database meng-import `server-only`, sehingga impor tak sengaja dari client
component menggagalkan build, bukan bocor saat runtime. Tipe provider yang dipakai
bersama hidup di modul terpisah khusus untuk menjaga batas itu tetap utuh.

**Tepat satu bot, tepat tiga chat.** `isChatAllowed` membandingkan chat id secara
persis, dan gagal tertutup (fail closed) ketika tidak ada slot yang dikonfigurasi.
Tidak pernah berupa pencocokan substring atau awalan.

**Webhook adalah satu-satunya jalur tulis publik**, dan ia hanya menerima bentuk
update Telegram.

---

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan |
| `npm run build` | Build produksi |
| `npm run start` | Menjalankan hasil build produksi |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint .`, flat config dengan `next/core-web-vitals`) |
| `npm run test` | Unit test (Vitest) |
| `npm run test:watch` | Sama, dalam mode watch |
| `npm run db:generate` | Membuat migration dari perubahan skema |
| `npm run db:migrate` | Menerapkan migration yang tertunda |
| `npm run db:seed` | Menulis pengaturan default dan baris config |
| `npm run db:seed:demo` | Mengisi database **lokal** dengan lalu lintas contoh |
| `npm run db:studio` | Drizzle Studio |
| `npm run qa:smoke` | Uji reliability end-to-end (lihat di bawah) |
| `npm run qa:audit` | Sapuan responsif/kontras/aksesibilitas terhadap dev server yang sedang jalan |
| `npm run qa:shots` | Mengambil screenshot ke `.shots/` |
| `npm run gen:key` | Menghasilkan `ENCRYPTION_KEY` baru |

### `npm run qa:smoke`

Menyalakan database SQLite sekali pakai dan HTTP lokal pengganti untuk provider
AI, lalu menggerakkan gateway **asli** melalui sebelas skenario: jalur bahagia,
update duplikat, chat tidak berwenang, fallback setelah `503`, retry di tempat
yang berhasil memulihkan diri dari `429`, `400` yang benar-benar menghentikan
rantai, provider timeout, kredensial tidak valid, kegagalan pengiriman ke
Telegram, update malformed, dan sapuan untuk kebocoran kredensial. Hanya
`api.telegram.org` yang di-stub, jadi lapisan adapter, timeout, router, trace, dan
persistence benar-benar teruji.

```
✓ all checks passed — 72 passed, 0 failed
```

Perintah ini tidak butuh akses jaringan dan tidak menyentuh data kamu.

---

## Pengujian

```bash
npm run test
```

115 unit test di tujuh file, terkonsentrasi pada logika yang tidak boleh regresi
tanpa disadari:

| File | Mencakup |
|---|---|
| `lib/telegram/validate.test.ts` | Validasi bentuk update, allowlist chat, perbandingan secret token |
| `lib/gateway.test.ts` | Seluruh pipeline: idempotensi, otorisasi, persistensi, kegagalan provider, kegagalan pengiriman, urutan trace |
| `lib/providers/router.test.ts` | Keputusan retry vs. fallback, penelusuran rantai, kondisi berhenti, pencatatan percobaan, klasifikasi status HTTP |
| `lib/crypto.test.ts` | Putaran balik enkripsi, deteksi manipulasi, penyamaran |
| `lib/sanitize.test.ts` | Pembersihan kredensial di teks, header, metadata, dan error |
| `lib/telegram/client.test.ts` | Pemecahan pesan terhadap batas 4096 karakter milik Telegram |
| `lib/settings.test.ts` | Putaran balik pengaturan, clamping, dan fallback |

### Advisory dependensi

`npm audit` hanya melaporkan temuan tingkat moderate, semuanya di tooling khusus
pengembangan (esbuild yang dibundel `drizzle-kit`, dan `@vitest/mocker` di Vitest
3, yang perbaikannya ada di Vitest 4). Keduanya tidak bisa dicapai dari build yang
sudah dideploy: keduanya hanya memengaruhi dev server lokal dan test runner.
Dependensi runtime bersih — termasuk `drizzle-orm` ≥ 0.45.2 yang menutup advisory
escaping identifier SQL, serta `sharp`/`postcss` yang dikunci lewat `overrides` di
luar range dependensi Next 15.5.

---

## Desain

**"Signal Console."** Subjeknya adalah sebuah panel pertukar: sebuah sinyal tiba,
melintasi rantai pemroses, lalu mendarat atau pecah. Antarmukanya adalah konsol
grafit hangat dengan satu warna indikator kuningan, karena indikator hidup
sebaiknya terbaca sebagai lampu yang menyala, bukan sebagai glow.

- **Dark dan light sama-sama dirancang**, bukan satu diinversi jadi yang lain.
  Default mengikuti sistem kamu; pilihannya disimpan dan diterapkan di sisi server.
- **Archivo** untuk antarmuka, **JetBrains Mono** untuk telemetri, id, dan
  timestamp — supaya correlation id terbaca sebagai data, bukan sebagai prosa.
- Panel dipisahkan oleh garis rambut 1px, bukan oleh jarak dan bayangan.
  Radius sudut dijaga kecil: 6px untuk kontrol, 8px untuk panel.
- Warna bersifat reservasi. Hijau, amber, dan merah masing-masing berarti tepat
  satu hal, dan aksen kuningan dipakai untuk suara produk sendiri, tidak pernah
  untuk status.
- Glassmorphism hanya muncul di tempat yang pantas — top bar dan popover — bukan
  sebagai perlakuan menyeluruh atas setiap kartu.
- Request trace adalah pusat gravitasi, dan semua yang lain ditata untuk
  mengarah ke sana.

`npm run qa:audit` menyapu setiap halaman di lima viewport dalam dua tema dan
memeriksa kontras teks/latar belakang, overflow horizontal, area sentuh yang
sesungguhnya (menggunakan `elementFromPoint`, bukan sekadar bounding box), ukuran
teks, dan struktur landmark. Saat ini tidak ada masalah yang dilaporkan.

> Catatan jujur: pemeriksaan visual di sini dilakukan lewat `scripts/audit.mjs`,
> bukan dengan melihat screenshot secara langsung.

---

## Troubleshooting

**Bot tidak membalas.**
Buka request trace yang cocok. Urutan kemungkinan:

1. *Tidak ada request sama sekali yang dibuat* — chat-nya tidak ada di allowlist.
   Cek Settings → Telegram, dan pastikan itu **chat** id.
2. *`Chat authorized` tidak ada* — webhook belum terdaftar, atau menunjuk ke
   deployment lain. Klik **Check status**.
3. *`Telegram delivery failed`* — bot dikeluarkan dari chat, atau diblokir.
4. *`No providers available`* — tidak ada provider yang aktif, atau primary belum
   diset.

**`No database is configured.`**
Sebuah deployment mencapai jalur request tanpa `TURSO_DATABASE_URL`. Ini disengaja:
di Vercel filesystem-nya read-only, sehingga jatuh ke berkas SQLite lokal akan
gagal belakangan dengan error driver yang membingungkan. Tambahkan variabelnya ke
proyek Vercel lalu deploy ulang.

**`TURSO_DATABASE_URL points at a remote database but TURSO_AUTH_TOKEN is not set.`**
Token-nya kosong atau tidak ada. Buat token read-write dengan
`turso db tokens create` lalu tambahkan. Token read-only akan terkoneksi lalu
gagal saat penulisan pertama, dan itu muncul sebagai kegagalan request, bukan
kegagalan startup.

**`Failed to fetch` / 500 di setiap halaman.**
Database-nya terjangkau tapi tidak menjawab. Pastikan `npm run db:migrate` sudah
dijalankan terhadap database itu, dan token-nya punya cakupan tulis.

**`ENCRYPTION_KEY is not set`.**
Tambahkan lalu deploy ulang. Kalau berubah setelah secret tersimpan, nilai lama
tidak terbaca — kosongkan bot token dan provider key, lalu masukkan ulang.

**Dashboard menanyakan admin key.**
`ADMIN_API_KEY` diisi di environment. Masukkan nilai yang sama, atau hapus
variabelnya kalau memang tidak bermaksud memakai proteksi itu.

**Webhook sudah terdaftar tapi pesan tetap datang lewat `getUpdates`.**
Telegram tidak bisa mengirim lewat dua cara sekaligus. Hapus update bot sekali
dengan `/deleteWebhook`, atau pakai **Remove webhook** di dashboard dulu, baru
daftar ulang. Kedua mode itu saling eksklusif.

**Tes provider gagal dengan 401 padahal key-nya kelihatan benar.**
Cek ada spasi nyasar, awalan `sk-` yang hilang, atau base URL yang tidak cocok
dengan key vendornya (key Groq tidak akan jalan di OpenRouter).

**Ganti model tapi tidak ada yang terjadi.**
Model per-request berasal dari baris provider; `temperature` dan `maxTokens`
tingkat percakapan di Settings hanya berlaku kalau provider tidak mengatur
nilainya sendiri. Kosongkan nilai milik provider untuk mewarisi nilai global.

**Build memberi peringatan tentang beberapa lockfile.**
Ada `package-lock.json` di direktori di atas repository. Ini tidak berbahaya —
proyek ini mengunci `outputFileTracingRoot` sendiri — atau hapus berkas
asing tersebut.

---

## Lisensi

Privat dan personal. Pakai, ubah, simpan.
