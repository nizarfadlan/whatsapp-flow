# WhatsApp Flow Builder — Perbaikan & Penyempurnaan

Rencana ini melengkapi `plan.md`. Fokus: perbaiki node yang error/half-baked, ganti
konsep Start → Trigger, tambah upload media, contact/group store (multi-tenant ready),
dan rapikan chat/history dua arah.

Keputusan yang sudah disepakati:
1. **Start node JADI Trigger** — satu entry point, hapus kategori "Triggers" dari palette.
2. **Media storage = adapter** — pakai S3/R2/MinIO kalau env diset, fallback ke local disk
   kalau tidak ada. Dikontrol dari env/config.
3. **Contact/Group = sync dari Baileys + manual.**

---

## Bagian A — Start node menjadi Trigger

### Masalah sekarang
- `start` adalah node statis non-deletable yang cuma dekorasi.
- Trigger justru jadi kategori palette terpisah + hack "only one trigger allowed".
- Executor (`flow-executor.ts:77` `getTriggerNode`) cari node `trigger-*`, jalan dari situ —
  start node diabaikan. Jadi ada dua "entry point" yang membingungkan.

### Target
Node pertama (id `start`, non-deletable) langsung jadi trigger: punya field `triggerKind`
(`keyword | any | webhook | schedule`) + config inline. Palette tidak lagi punya kategori
Triggers.

### Perubahan file
- `apps/web/src/components/flow-nodes.tsx`
  - Gabung `StartNodeData` + `TriggerNodeData` → satu `TriggerNodeData` dengan
    `nodeType: "trigger"`, field `triggerKind`, `category: "trigger"`, `deletable:false`.
  - `nodeTypes`: hapus `trigger-keyword/any/webhook/schedule` & `start`; ganti satu `trigger`.
  - `createStartNode()` → `createTriggerNode()`: default `triggerKind:"keyword"`, keyword "".
  - `paletteCategories`: buang kategori "Triggers".
  - `TriggerNode` komponen: tampilkan ikon sesuai `triggerKind`, ringkasan config, hanya
    source handle (tidak ada target handle).
- `apps/web/src/components/node-config-panel.tsx`
  - `TriggerConfigForm`: tambah `<Select>` untuk `triggerKind` di paling atas, lalu render
    sub-form sesuai pilihan (keyword/webhook/schedule; "any" = tanpa config).
  - Untuk trigger, sembunyikan tombol Delete + field Label boleh tetap ada (opsional).
- `apps/web/src/routes/dashboard.flows.$flowId.tsx`
  - `ensureStartNode` → `ensureTriggerNode` (seed node `trigger` kalau belum ada; migrasi
    node lama `start`/`trigger-*` jadi `trigger`).
  - `getTriggerPayload`: baca dari node `trigger` (pakai `triggerKind`).
  - `hasTriggerNode`/`isTriggerType`: cek `node.type === "trigger"`.
  - Hapus guard "only one trigger allowed" dari palette add/drop (tidak relevan lagi).
- `packages/api/src/routers/flow.ts`
  - `getTriggerPayload` & `validateFlowGraph`: deteksi trigger lewat `type === "trigger"` +
    `data.triggerKind` (bukan `startsWith("trigger-")`).
- `packages/api/src/engine/flow-executor.ts`
  - `getTriggerNode`: `nodes.find(n => n.type === "trigger")`.
- **Backward-compat**: `ensureTriggerNode` + helper migrasi memetakan node lama
  (`start`, `trigger-keyword`, dst.) ke bentuk baru saat flow lama dibuka, supaya data
  JSONB existing tidak rusak. Tidak perlu migrasi DB (nodes/edges = JSONB).

---

## Bagian B — Perbaikan fitur node yang error / setengah jadi

### B1. Send Reaction (saat ini selalu error)
Akar masalah: `react` butuh `messageKey` pesan pemicu, tapi key tak pernah masuk ke
execution context.
- `packages/whatsapp/src/types.ts` `ConnectionManagerEvents["device:message"]`: tambahkan
  `messageKey` (WAMessageKey) ke payload.
- `connection-manager.ts` `handleMessagesUpsert`: sertakan `message.key`.
- `packages/whatsapp/src/message-handler.ts` `IncomingMessage`: tambah `messageKey`.
- `flow-executor.ts` `ExecutionContext`: simpan `triggerMessageKey?`. Diisi dari dispatcher
  (message trigger) — null untuk schedule/webhook.
- `executeFlow`/`resumeFlowSession`/dispatcher: teruskan `messageKey`.
- `executeNode` case `send-reaction`: kalau ada key → `sendWhatsAppMessage(... {type:"reaction",
  text: emoji, messageKey})`. Kalau tidak ada (schedule/webhook) → tandai skip dengan output
  jelas, bukan "error".

### B2. Send Image / Video / Audio / Document — upload, bukan cuma URL
Lihat Bagian C (storage). Di node:
- `MediaConfig`/`DocumentConfig` di `node-config-panel.tsx`: tambah komponen upload
  (drag/drop + file picker) di samping input URL. Setelah upload → set `mediaUrl` ke URL
  hasil storage + simpan `mediaKey`/`mimeType`/`fileName` ke node data.
- Node visual: preview thumbnail kecil kalau `mediaUrl` berupa gambar.
- Executor sudah kirim `{ image:{ url } }` — tetap jalan karena URL bisa publik (S3) atau
  route lokal yang di-serve server.

### B3. Send List & Quick Reply (saat ini opsi/section hilang)
Sekarang executor cuma kirim `bodyText` sebagai teks polos.
- `message-sender.ts`: tambah tipe outgoing `list`, `buttons` (interactive). Karena Baileys
  7.x dukungan native button/list terbatas/berisiko, default render jadi **teks ber-nomor**
  yang rapi (body + daftar opsi + footer) — tapi simpan struktur asli supaya `wait-for-reply`
  / condition bisa mencocokkan balasan angka/teks ke opsi.
- `executeNode` `send-list`/`send-quick-reply`: bangun teks dari `sections`/`buttons`
  (bukan hanya bodyText). Sertakan footer.
- (Opsional, flag) coba kirim native interactive message bila tersedia; fallback ke teks.

### B4. Forward — pilih kontak dari dropdown + forward beneran
- Node `forward`: ganti input nomor manual jadi **Combobox kontak** (Bagian C) +
  opsi "nomor manual". Field: `targetNumber` (tetap), `targetContactId?`.
- Executor `forward`: saat ini cuma kirim teks `"Forwarded from X"`. Perbaiki agar
  benar-benar relay konten pesan pemicu:
  - Kalau `triggerMessageKey`/raw ada → forward isi pesan (teks/media caption) ke target.
  - Simpan jejak di nodeResults.

### B5. Polish kecil lain
- `send-text` & beberapa config pakai `<Input>` 1 baris → ganti `Textarea` untuk teks panjang.
- Validasi node media di `flow.ts`: terima `mediaUrl` ATAU `mediaKey` (hasil upload).

---

## Bagian C — Media storage adapter (S3 / local, dari env)

### Env (`packages/env/src/server.ts`)
Tambah opsional:
```
STORAGE_DRIVER         "s3" | "local" (default: "local" bila S3 tidak lengkap)
S3_ENDPOINT            url (R2/MinIO)        — opsional
S3_REGION              string                — opsional
S3_BUCKET              string                — opsional
S3_ACCESS_KEY_ID       string                — opsional
S3_SECRET_ACCESS_KEY   string                — opsional
S3_PUBLIC_URL          base URL publik objek — opsional
LOCAL_UPLOAD_DIR       default "uploads"
PUBLIC_BASE_URL        base URL server (utk bikin URL absolut lokal)
```
Aturan: kalau semua kredensial S3 ada → driver `s3`; selain itu → `local`.

### Paket storage baru `packages/storage`
- `src/index.ts` ekspor `storage` (adapter terpilih) + tipe.
- `src/types.ts`: `interface StorageDriver { put(key, bytes, mime): Promise<{url,key}>;
  presignPut?(key, mime): Promise<{uploadUrl, publicUrl, key}>; resolveUrl(key): string }`.
- `src/s3.ts`: pakai `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (presigned PUT).
- `src/local.ts`: tulis ke `LOCAL_UPLOAD_DIR`, kembalikan URL `PUBLIC_BASE_URL/uploads/<key>`.
- `src/select.ts`: pilih driver dari env.

### Server (`apps/server/src/index.ts`)
- Route statis `GET /uploads/*` (Hono `serveStatic`) untuk driver lokal.
- Untuk S3: presign dipakai langsung dari client, server tak menyentuh bytes.

### API upload (`packages/api/src/routers/media.ts` baru)
- `media.createUploadUrl` (S3): input `{ fileName, mimeType, size }` →
  `{ uploadUrl, publicUrl, key }` (presigned). Validasi mime & size.
- `media.uploadLocal` (local): terima base64/multipart kecil → simpan → `{ url, key }`.
  (Atau route Hono khusus `POST /api/uploads` multipart untuk file besar — lebih baik.)
- Daftarkan di `routers/index.ts`.

### Web
- Komponen `media-upload.tsx` di `packages/ui` atau `apps/web/src/components`:
  pilih file → (S3) minta presigned URL lalu PUT langsung; (local) POST ke server →
  callback `onUploaded({url, key, mime, fileName})`.
- Dipakai di MediaConfig/DocumentConfig (B2).

---

## Bagian D — Contact, Group, Chat list, History (multi-tenant & multi-device)

### Prinsip desain
- Skopnya **per device** (bukan per user) karena kontak/grup milik akun WA tertentu.
  Ownership user diturunkan via `device.userId` (sudah ada). Multi-tenant aman karena tiap
  query join ke `device` + filter `device.userId`.
- Tabel baru di `packages/db/src/schema/contact.ts` (+ re-export di `schema/index.ts`).

### Skema baru
**`contact`** — kontak per device
```
id            text PK
deviceId      text FK→device (cascade)
jid           text         (xxx@s.whatsapp.net)
phoneNumber   text
name          text         (nama dari WA / address book)
pushName      text         (nama yang ditampilkan kontak)
isWaContact   boolean      (terdaftar di WA)
isBlocked     boolean
source        enum         'sync' | 'manual' | 'message'
avatarUrl     text         nullable
createdAt/updatedAt
UNIQUE(deviceId, jid)
INDEX(deviceId), INDEX(deviceId, phoneNumber)
```

**`group`** — grup per device
```
id            text PK
deviceId      text FK→device
jid           text         (xxx@g.us)
subject       text         (nama grup)
description   text
ownerJid      text
participantCount int
isMember      boolean
source        enum 'sync' | 'manual'
createdAt/updatedAt
UNIQUE(deviceId, jid)
```

**`group_participant`** (opsional, fase lanjut) — anggota grup
```
id, groupId FK→group, jid, role enum('member','admin','superadmin'), createdAt
UNIQUE(groupId, jid)
```

### Reuse inbox sebagai chat list + history (dua arah)
`inbox_thread` + `inbox_message` sudah ada, tapi inbound-only & private-only. Perluas:
- **Dua arah**: saat flow/engine kirim pesan keluar → tulis `inbox_message` direction
  `outbound` + update thread. Tambah hook di `flow-executor` (helper `recordOutbound`)
  dan di tempat kirim manual.
- **Group vs private**: tambah kolom `chatType` enum `private|group` & `groupJid?` di
  `inbox_thread`; `contactNumber` jadi nullable utk grup. (Migrasi JSONB? Tidak — ini kolom
  DDL, perlu `db:push`.)
- Link thread ke `contact`/`group` via `contactId?`/`groupId?` (nullable, best-effort).

### Sync dari Baileys
Di `connection-manager.ts`, daftarkan listener & emit event:
- `contacts.upsert` / `contacts.update` → upsert `contact` (source `sync`).
- `groups.upsert` / `groups.update` / `group-participants.update` → upsert `group`.
- `messaging-history.set` → backfill kontak/grup/awal chat. Ubah
  `shouldSyncHistoryMessage` agar mengizinkan sync awal (bisa dibatasi N pesan terbaru).
- Emit `device:contacts`, `device:groups`; handler persist di server (mirip
  `device:message` yang sudah ada).
- Saat pesan masuk dari nomor baru → upsert contact source `message` (auto).

### tRPC routers baru
- `packages/api/src/routers/contact.ts`: `list` (filter deviceId, search, pagination),
  `getById`, `create` (manual), `update`, `delete`, `importFromSync` (trigger re-sync).
- `packages/api/src/routers/group.ts`: `list`, `getById`, (opsional) `participants`.
- Daftarkan di `routers/index.ts`.
- `inbox.ts`: tambah `sendMessage` (kirim manual dari UI, sekaligus catat outbound),
  dukung `chatType`/group.

### Web
- Route `dashboard.contacts.tsx`: tabel kontak per device + tambah/edit manual + search.
- Route `dashboard.groups.tsx`: daftar grup.
- Sidebar: tambah menu Contacts & Groups.
- **Forward node** & tempat lain pakai `ContactCombobox` (query `contact.list`) →
  ini yang kamu minta: dropdown kontak tersimpan.
- Inbox: tampilkan bubble dua arah (inbound/outbound), badge group.

---

## Urutan implementasi (disarankan)

| Step | Isi | Area | Effort |
|---|---|---|---|
| 1 | Start→Trigger (FE + executor + flow router) | A | Medium |
| 2 | Fix reaction (key plumbing) | B1 | Small |
| 3 | Fix list/quick-reply/forward executor | B3,B4 | Small |
| 4 | DB: contact, group (+inbox kolom chatType/outbound) | D | Medium |
| 5 | Baileys sync events → contact/group + outbound logging | D | Medium |
| 6 | tRPC contact/group/inbox.sendMessage routers | D | Medium |
| 7 | `packages/storage` adapter (s3/local) + env | C | Medium |
| 8 | API media upload + komponen upload web | C,B2 | Medium |
| 9 | Web: Contacts/Groups pages + sidebar + ContactCombobox | D | Medium |
| 10 | Web: media upload di node, textarea, forward combobox | B2,B4,B5 | Medium |
| 11 | Inbox dua arah UI + group | D | Small |
| 12 | Polish + validasi + `bun run check` & `check-types` | semua | Small |

## Catatan teknis / risiko
- **Baileys 7.0.0-rc13**: nama event history sync = `messaging-history.set`. Native
  interactive (button/list) tidak stabil → default fallback teks (B3).
- Perubahan DDL (contact/group, kolom inbox baru) butuh `bun run db:push`.
- Reaction & forward butuh `messageKey`/raw dari pesan pemicu — hanya tersedia di trigger
  `message`, jadi untuk schedule/webhook ditandai "skipped" yang jelas.
- Storage adapter: kalau S3 env tak lengkap, otomatis local — tidak ada breaking config.
