# Source Code Map — NativeMP3Converter V1.0

- `js/app.js`：直接以原生 ES Module 啟動；不再使用 dynamic import bootstrap。
- `js/boot-check.js`：啟動錯誤顯示與慢載入提示。
- `js/app.js`：UI、批次、資料夾、Recovery、自動輸出。
- `js/wav-stream.js`：bounded RIFF/WAV parser 與 chunk PCM decode。
- `js/wav-mp3-streamer.js`：WAV → Native MP3 streaming orchestration。
- `js/native-audio-decoder.js`：Web Audio fallback。
- `js/pcm-safety.js`：PCM 記憶體估算。
- `js/mp3/native-mp3-encoder.js`：CHOPPER Native MP3 Core v0.4.1。
- `js/mp3/mp3-validator.js`：完整 MP3 frame scanner。
- `js/mp3/encoder-worker.js`：fallback Worker encoder。
- `js/output-store.js`：fresh output IndexedDB，7 天 read-time TTL。
- `js/recovery-store.js`：fresh Recovery IndexedDB，7 天 TTL。
- `js/handle-store.js`：fresh Directory Handle IndexedDB，30 天 TTL。
- `js/fingerprint.js`：前／中／後取樣 SHA-256。
- `js/path-utils.js`：檔名、路徑、CSV 安全。
- `js/safe-file-commit.js`：`.part` / backup / rollback。
- `js/zip-store.js`：ZIP32 Store、CRC32、path traversal 防護。
- `sw.js`：fresh cache namespace、固定 allow-list、navigation network-first。
- `scripts/*`：語法、資安、Codec、DOM、TTL、輸出流程與 adversarial regression。


## V1.0.2 Classic Bundle Runtime

GitHub Pages 正式執行入口為 `js/app.bundle.js`。此檔由 `scripts/build_classic_bundle.py` 從可讀的模組原始碼產生，並內嵌 Native MP3 Worker source。正式頁面不再依賴 ES Module import graph；原本的 `js/*.js` 模組保留供原始碼審閱與回歸測試。
