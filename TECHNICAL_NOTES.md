# NativeMP3Converter V1.0 — CHOPPER Native MP3 Core v0.4.1 Technical Notes

## 兩條處理路徑

### A. WAV Streaming Path

```text
WAV File
 → bounded RIFF chunk parser
 → pass 1: chunk peak scan
 → pass 2: chunk PCM decode
 → StreamingMp3Encoder.push()
 → MP3 frames
 → .part writable stream / Blob collector
 → full MP3 frame validation
 → safe commit
```

支援 RIFF PCM 8/16/24/32-bit、IEEE Float32、G.711 A-law / μ-law，以及 WAVE_FORMAT_EXTENSIBLE 的 PCM / Float 子格式，1～2 聲道。來源 8～48 kHz；MP3 encoder 仍使用 32/44.1/48 kHz，其他常見語音取樣率會在串流途中重採樣。RF64 與 ADPCM 暫不走 Native streaming path。

### B. Browser Decode Fallback

```text
compressed / unsupported WAV
 → PCM memory preflight
 → AudioContext.decodeAudioData()
 → optional OfflineAudioContext 44.1 kHz render
 → transferable Float32 PCM
 → encoder Worker
 → MP3 Blob
 → full frame validation
 → output
```

這一路徑仍會持有整份 decoded PCM，因此不是低記憶體串流。

## Native Core v0.4.1

- MPEG-1 Layer III frame stream。
- 32 / 44.1 / 48 kHz。
- Mono / Stereo。
- 64～320 kbps CBR。
- persistent analysis-bank / MDCT history across chunks。
- adaptive per-frame granule/channel bit budget。
- minimum global-gain search。
- bitrate-dependent low-pass band limit。
- peak protection。
- strict equal-length PCM channel input。
- 非有限 PCM sample 以 0 處理，避免 NaN / Infinity 污染 bitstream 計算。

## 尚未實作

- short-block / transient switching。
- bit reservoir (`main_data_begin = 0`)。
-完整 psychoacoustic masking model。
- scalefactor optimization。
- adaptive Huffman codebook selection（目前 table 5）。
- joint stereo / intensity stereo。
- VBR / ABR。
- Xing/LAME gapless metadata。

## MP3 驗證

`mp3-validator.js` 逐 frame 驗證：

- MPEG-1 Layer III sync / header。
- bitrate / sample rate / channel consistency。
- 每 frame 計算長度與檔案邊界。
- 完整檔無 trailing partial frame。
- 由 frame 數計算 codec duration。

它不是音質評分器；「結構合法」與「主觀音質好」是兩件不同的事。

## Direct-output commit

串流先產生 `.part`。驗證後提交正式檔；若正式檔原本存在，提交前另存本站 backup sidecar。若正式寫入失敗，程式嘗試用 backup 回復舊檔；若回復本身也失敗，錯誤訊息會保留 backup 名稱供人工處理。


## V1.0.3 Classic Bundle Runtime

GitHub Pages 正式執行入口為 `js/app.bundle.js`。此檔由 `scripts/build_classic_bundle.py` 從可讀的模組原始碼產生，並內嵌 Native MP3 Worker source。正式頁面不再依賴 ES Module import graph；原本的 `js/*.js` 模組保留供原始碼審閱與回歸測試。


## V1.0.4 Same Folder Workflow

同資料夾輸出改為顯式來源資料夾授權流程。一般 File / webkitdirectory 匯入不會被視為可寫入權限；使用者選擇 alongside 後，由 `showDirectoryPicker()` 取得 readwrite Handle，逐筆核對目前來源，再把 `sourceDirHandle` 綁定到已驗證項目。全部核對成功前不會啟用直接寫回。


## V1.0.5 Telephony WAV Native Decode

WAV parser 會解析 `fmt ` 的實際 format tag，而不是只看 `.wav` 副檔名。G.711 A-law / μ-law 以 JavaScript 逐 sample 解碼；WAVE_FORMAT_EXTENSIBLE 會驗證標準 SubFormat GUID，只接受 PCM / IEEE Float。低取樣率語音在串流中以連續狀態線性 interpolation 重採樣至 32 kHz，避免把整份 PCM 留在記憶體。

目前明確不宣稱支援 Microsoft ADPCM (format 2) 與 IMA ADPCM (format 17)。遇到時 parser 會回報 codec 名稱，讓後續可針對實際來源再擴充。

## V1.0.6 GSM 6.10 / Microsoft WAV format 49

- WAVE format tag: `0x0031` (decimal 49), `WAVE_FORMAT_GSM610`.
- Microsoft WAV packing: 65 bytes = 520 bits = two 260-bit GSM speech frames; frame B begins at bit 260 (byte 32 bit 4).
- Field packing is LSB-first for the Microsoft WAV variant.
- Decoder stages: LAR decode/interpolation → APCM inverse + RPE grid → long-term synthesis → short-term lattice synthesis → de-emphasis → output truncation.
- Persistent decoder state is kept across blocks for LTP history, LAR interpolation, short-term synthesis memory and de-emphasis.
- 8 kHz mono PCM is streamed into the existing linear resampler and converted to 32 kHz before MP3 encoding.
- Release regression includes an independently generated MS-GSM 65-byte fixture whose 320 decoded PCM samples are SHA-256 checked against FFmpeg/libgsm_ms output.
