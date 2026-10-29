# Design System & Style Guide
## Dann Desktop Assistant — Neubrutalist UI & Mascot Guidelines

* **Versi Style Guide:** 1.0.0
* **Filosofi Desain:** Playful Neubrutalism (High-Contrast Outlines, Hard Offset Shadows, Vibrant Retro Pastels, Character-Driven Warmth)
* **Font Utama:** `Plus Jakarta Sans`

---

## 1. Filosofi & Karakter Visual

**Dann** menggabungkan estetika **Neubrutalisme Modern** dengan kepribadian maskot anime/kartun yang ramah dan energetik:
1. **Kejelasan Maksimal (High Contrast):** Garis batas hitam pekat (*solid black 2.5px–3px border*) di setiap elemen kartu, tombol, dan bubble bicara menjamin keterbacaan di atas latar belakang desktop apa pun.
2. **Bayangan Keras Tanpa Blur (Hard Offset Shadows):** Efek kedalaman tidak menggunakan blur lembut, melainkan *solid drop shadow* dengan offset nyata (`3px` hingga `6px`), memberikan impresi fisik seperti stiker pop-art yang menempel di layar.
3. **Warna Pastel Retro Berani:** Warna latar dasar bernuansa hangat (*cream paper*), dipadukan dengan aksen neon pop seperti kuning kenari, hijau limau, merah muda ceria, dan biru langit.
4. **Interaksi Taktil (Tactile Press):** Setiap tombol dan elemen interaktif merespons klik dengan efek turun (*depressed physical push*) ke arah bayangannya.

---

## 2. Palet Warna (Color Tokens)

Semua token warna didefinisikan secara sentral di CSS `:root` ([`src/styles/index.css`](file:///d:/WAGZ/PROJEK/PRIBADI/GAME/assistant/src/styles/index.css)):

### 2.1 Warna Dasar & Permukaan (Surfaces & Inks)
| Token CSS | Hex Code | Swatch | Penggunaan |
| :--- | :--- | :--- | :--- |
| `--nb-bg` | `#FFFDF7` | Warm Cream | Latar belakang utama jendela Dashboard |
| `--nb-sidebar` | `#FFF6CC` | Soft Butter | Sidebar navigasi Dashboard |
| `--nb-surface` | `#FFFFFF` | Pure White | Kartu konten, bubble percakapan, popup |
| `--nb-ink` | `#0F172A` | Slate Ink | Teks isi utama (body copy), sub-judul |
| `--nb-black` | `#000000` | Pure Black | Garis tepi (*borders*), bayangan (*shadows*), judul tebal |
| `--nb-muted` | `#475569` | Cool Slate | Teks sekunder, metadata, deskripsi pembantu |

### 2.2 Warna Aksen Neubrutalis (Accents & Badges)
| Token CSS | Hex Code | Nama Warna | Konteks Penggunaan |
| :--- | :--- | :--- | :--- |
| `--nb-yellow` | `#FFD803` | Canary Yellow | Brand utama Dann, tombol aksi primer, status Standby |
| `--nb-lime` | `#A3E635` | Vibrant Lime | Status Berhasil, Active, Mic On, Ready |
| `--nb-mint` | `#5EEAD4` | Fresh Mint | Badge Spotify, status sehat, notifikasi informatif |
| `--nb-pink` | `#FF90E8` | Bubblegum Pink | Badge YouTube, mode lirik bernyanyi, kartu ekspresif |
| `--nb-sky` | `#7DD3FC` | Cloud Sky | Badge AI Cloud (Gemini/Groq), dialog bantuan |
| `--nb-violet` | `#C4B5FD` | Soft Violet | Modul catatan (Notes), shortcut manager |
| `--nb-coral` | `#FF6B6B` | Punch Coral | Status Bahaya, peringatan, tombol hapus, badge Alert |

---

## 3. Tipografi (Typography)

Asisten menggunakan tipografi modern berlapis tebal dengan proporsi ramah:

```css
font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
```

### 3.1 Skala & Hierarki Font
* **Display / Hero (24px – 28px, Weight: 800):** Judul utama Dashboard, headline modal.
  * `letter-spacing: -0.03em; line-height: 1.2;`
* **Heading 2 (18px – 20px, Weight: 800):** Judul seksi kartu, judul playlist musik.
  * `letter-spacing: -0.02em;`
* **Heading 3 (14px – 16px, Weight: 700):** Label grup, judul catatan to-do.
* **Body Regular (13px – 14px, Weight: 500 / 600):** Teks balasan asisten, lirik utama, konten catatan.
  * `line-height: 1.45; color: var(--nb-ink);`
* **Caption / Meta (11px – 12px, Weight: 600 / 700):** Artis musik, timestamp, petunjuk tombol shortcut.
* **Pill & Tag Badges (10px – 11px, Weight: 800, Uppercase):**
  * `letter-spacing: 0.08em; text-transform: uppercase;`

---

## 4. Garis Batas, Bayangan & Sudut (Borders, Shadows & Radii)

Ciri khas Neubrutalisme diimplementasikan dengan aturan ketat:

### 4.1 Token Garis Batas (Borders)
```css
--nb-border: 2.5px solid #000000;       /* Kartu standar, input field, tombol */
--nb-border-thick: 3px solid #000000; /* Dialog bubble, floating control bar */
```

### 4.2 Token Bayangan Keras (Offset Shadows)
```css
--nb-shadow-sm: 3px 3px 0px #000000;  /* Tombol kecil, badge interaktif */
--nb-shadow:    4px 4px 0px #000000;  /* Kartu Dashboard, bubble ucapan */
--nb-shadow-lg: 6px 6px 0px #000000;  /* Modal popup, floating menu */
```

### 4.3 Efek Taktil Saat Ditekan (Active Button State)
```css
.nb-btn:active,
.nb-mini-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0px #000000;
}
```

### 4.4 Sudut Melengkung (Border Radii)
Neubrutalisme Dann memilih gaya *rounded playful* agar terasa bersahabat bagi maskot:
* **Kartu & Bubble Utama:** `16px` – `20px`
* **Tombol & Input:** `10px` – `12px`
* **Pill Badges & Tag:** `999px` (Full Pill)

---

## 5. Pedoman Maskot & Panggung Karakter (Mascot Staging)

Karakter visual Dann bertindak sebagai representasi fisik dari asisten:

### 5.1 Penempatan & Docking (Zero Gap Desktop Rule)
* Torso/badan karakter maskot **harus menempel langsung ke batas piksel bawah desktop** (`padding-bottom: 0px`).
* Tidak boleh ada celah mengambang kosong antara tubuh karakter dan tepi monitor/taskbar Windows.
* Lebar panggung maskot berkisar antara `200px – 240px`.

### 5.2 Poses Karakter & Kapan Digunakan
1. **Pose 1 (`pose-idle.png`):** Karakter santai tersenyum. Digunakan saat asisten berada dalam mode standby, menunggu perintah.
2. **Pose 2 (`pose-listen.png`):** Karakter mengenakan headphone modern. Digunakan saat:
   - Dann mendengarkan suara pengguna (`orbStatus === 'awake'`).
   - Musik/video sedang diputar di latar belakang (`isGroovingMusic === true`), disertai animasi getaran musik (*grooving bob*).
3. **Pose 3 (`pose-alert.png`):** Karakter mengangkat tangan dengan gestur energetik/semangat. Digunakan saat menyemangati pengguna (*"Gas terus!"*) atau saat alarm pengingat berbunyi.
4. **Pose 4 (`pose-idea.png`):** Karakter menunjuk bohlam lampu kuning menyala. Digunakan saat memberikan jawaban kalkulasi, catatan tersimpan, atau saran solusi.

### 5.3 Transisi Slide Up & Slide Down
* **Slide Up (Muncul):**
  ```css
  transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
  transform: translateY(0%);
  ```
* **Slide Down (Sembunyi ke Bawah):**
  ```css
  transition: transform 0.36s cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateY(112%);
  ```
* **Peek Tab:** Saat karakter sedang bersembunyi di bawah layar, sebuah tab kecil berwarna kuning dengan teks `"DANN"` menyembul di batas layar bawah. Klik atau hover pada tab ini akan langsung memunculkan Dann kembali.

---

## 6. Komponen UI Utama (Key UI Components)

### 6.1 Speech Bubble (Balasan Bicara)
Bubble dialog yang muncul di atas kepala karakter saat Dann berbicara:
* Latar belakang: `--nb-surface` (putih) dengan border `2.5px solid #000`.
* Tag di pojok kiri atas: Label kecil warna-warni (misal: `MODE LOKAL`, `TIMER`, `CATATAN`, `AI DANN`).
* Bayangan: `4px 4px 0px #000`.
* Animasi: *Pop up bounce* lembut saat muncul.

### 6.2 Singing & Karaoke Music Card
Kartu neubrutalis untuk pemutar lagu:
* **Header Bar:** Menampilkan pill sumber (`SPOTIFY` warna mint, `YT MUSIC` warna pink, atau `YOUTUBE` warna coral) dengan **3 bar equalizer animasi CSS** yang bergerak naik-turun mengikuti tempo musik.
* **Teks Lirik Utama:** Berukuran `14px` tebal hitam pekat, menampilkan baris lirik aktif saat ini.
* **Teks Lirik Berikutnya:** Berukuran `12px` warna abu-abu muted, menampilkan baris lirik yang akan datang untuk panduan bernyanyi karaoke.
* **Fallback Mode:** Jika lirik lagu tidak tersedia di LRCLIB, baris utama tetap menampilkan Judul Lagu dan baris kedua menampilkan Nama Artis secara elegan.

### 6.3 Quick Controls Bar (Right-Click Mascot Menu)
Menu kontrol mini horizontal yang muncul hanya ketika karakter diklik kanan:
* Tombol Geser Posisi Horizontal (drag handle).
* Tombol Kontrol Lagu: Previous (`SkipBack`), Play/Pause, Next (`SkipForward`).
* Tombol Toggle Always-Listen Mic.
* Tombol Toggle Karaoke Lyrics.
* Tombol Buka Dashboard Utama.

---

## 7. Pedoman Suara & Gaya Bahasa (Copywriting Tone)

Kepribadian Dann adalah teman kerja yang santai, lincah, sopan, namun tidak formal-kaku:

### 7.1 Karakteristik Percakapan
* **Bahasa:** Bahasa Indonesia sehari-hari (*casual Indonesian* / gaul terdidik).
* **Panjang Kalimat:** 1 hingga 2 kalimat saja agar nyaman didengar melalui suara (*TTS*) dan cepat dibaca di layar.
* **Sikap:** Sigap (*can-do attitude*), ramah, dan solutif.

### 7.2 Contoh Respons DOs vs DONTs

| Situasi | JANGAN (Kaku / Terlalu Panjang) | GUNAKAN (Gaya Dann) |
| :--- | :--- | :--- |
| **Suara Kurang Jelas / ASR Meleset** | *"Saya mendengar 'xyz', tetapi belum mengenali perintah tersebut. Coba ucapkan Buka Kalkulator..."* | *"Hah, gimana tuh? Kurang kedengeran nih, coba ulangi lagi dong!"* |
| **Summon Saat Musik Berputar** | *"Audio telah dijeda. Silakan sampaikan instruksi Anda kepada sistem asisten."* | *"Iya! Musiknya aku pause dulu ya. Mau dibantu apa nih?"* |
| **Disuruh Pergi / Sembunyi** | *"Sistem telah beralih ke mode terminasi jendela di balik layar desktop."* | *"Oke siap bos, aku cabut ke bawah dulu ya!"* |
| **Menyetel Timer** | *"Pengingat dengan durasi waktu 300 detik telah berhasil disimpan dalam basis data."* | *"Baik, pengingat 5 menit sudah diatur ya!"* |
| **Memutar Musik** | *"Memulai proses pembukaan aplikasi Spotify dan melakukan pencarian kueri..."* | *"Siap, membuka Spotify dan langsung memutar lagunya!"* |
| **Membuka YouTube** | *"Proses pencarian video di peramban YouTube sedang dijalankan sekarang."* | *"Siap, langsung membuka videonya di YouTube!"* |

