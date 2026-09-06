# SECURITY / RELIABILITY AUDIT — NativeMP3Converter V1.0

## Fresh-project goals

1. 新 Repository 可用 GitHub Pages branch deploy，不依賴 Actions 或點開頭檔案。
2. 新 Service Worker scope / cache namespace 與舊 `AudioToMP3` 分離。
3. 新 IndexedDB / Directory Handle namespace，不讀取舊專案續作資料。
4. 保留既有 Native MP3、Streaming WAV、Output Recovery 與資料安全防護。

## 驗證項目

- Runtime remote URL = 0。
- `eval` / Function constructor / dangerous HTML sinks = 0。
- Strict CSP，無 inline handler。
- FFmpeg / WASM Runtime assets = 0。
- Service Worker 固定 allow-list，navigation network-first。
- Service Worker cache cleanup 僅能碰 `chopper-native-mp3-v1-*`。
- Output TTL 7 天 read-time fail-closed。
- CSV formula injection / ZIP traversal / source path sanitization。
- Safe `.part` + backup + rollback。
- Native MP3 32 / 44.1 / 48 kHz、Mono / Stereo、64～320 kbps regression。
- Malformed WAV / MP3 adversarial regression。
- DOM boot / output folder workflow regression。

## 已知限制

Native MP3 Core v0.4.1 是自行實作的功能性 encoder，尚未具備成熟 LAME encoder 的完整 psychoacoustic model、short block、bit reservoir、adaptive Huffman codebook、joint stereo、VBR 或 gapless metadata。
