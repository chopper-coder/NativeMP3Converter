# Security & Privacy — NativeMP3Converter V1.0.4

## 隱私邊界

- 音訊內容只在瀏覽器本機讀取、解碼與編碼。
- Runtime 不載入 CDN、遠端 JavaScript、遠端 codec、FFmpeg、WASM 或第三方轉檔 API。
- GitHub Pages 只提供 HTML / JS / CSS 等靜態資產，不會收到使用者選取的音檔內容。

## Fresh namespace

為避免同一 `github.io` origin 下的舊專案狀態干擾，本專案使用全新 namespace：

- CacheStorage：`cmp3-v1-*`（所有 picker id 均 ≤ 32 字元）
- Output IndexedDB：`chopper-native-mp3-v1-output`
- Recovery IndexedDB：`chopper-native-mp3-v1-recovery`
- Handle IndexedDB：`chopper-native-mp3-v1-handles`
- File System Access picker id：`cmp3-v1-*`（所有 picker id 均 ≤ 32 字元）

本專案不會主動刪除 `audio-to-mp3-*` 舊專案 cache。

## 持久化資料

- MP3 output cache：7 天，讀取時再次強制 TTL。
- Recovery metadata：7 天。
- Directory Handle：30 天，可手動忘記。
- 來源與輸出採取樣 SHA-256 指紋做低成本續作比對；不作為法律／鑑識完整性證明。

## 輸出與注入防護

- 原始 MP3 不會被同名重新轉碼結果直接覆蓋。
- 直接寫檔先寫 `.part`，驗證完整 MP3 frame 後才提交。
- 覆蓋模式先建立本站專用 backup，失敗時嘗試 rollback。
- UI 不使用 `eval`、`new Function`、`innerHTML=`、`document.write` 或 inline event handler。
- CSV 防 spreadsheet formula injection。
- ZIP 阻擋 path traversal、重複路徑與 ZIP32 overflow。
- CSP 將 script / connect 限制為同源；`worker-src` 只額外允許 `blob:`，用於內嵌的本機 Native MP3 Worker。

## 資源耗盡防護

- 工作區最多 10,000 檔案。
- 非串流來源先做 PCM working-set 估算。
- 大型 WAV 僅在相容 streaming path 下處理；不相容大型檔案不會強行完整 decode。

詳見 `SECURITY_AUDIT_V1.0.md`、`SECURITY_AUDIT_V1.0.3.md` 與 `SECURITY_AUDIT_V1.0.4.md`。
