# 音檔轉 MP3 V1.0.4｜Same Folder Workflow UX Edition

這是一個重新建立的乾淨專案。專案名稱建議使用 **NativeMP3Converter**，不要覆蓋舊的 `AudioToMP3` Repository。

## 為什麼重新建立

舊專案經過多次版本更新、Service Worker 與 GitHub Actions 調整。這個 V1.0 保留已驗證的 Native MP3 功能，但重新建立：

- Service Worker cache namespace
- IndexedDB output / recovery / handle database
- File System Access picker id
- GitHub Pages 部署流程
- SHA-256 source manifest
- 安全與回歸測試基線

因此新 Repository 不會主動清理或讀取舊 `AudioToMP3` 專案的 cache / IndexedDB / Directory Handle。

## 主要功能

- 純前端、本機音訊處理，不上傳音檔。
- CHOPPER Native MP3 Core v0.4.1，0 FFmpeg Runtime、0 WASM、0 CDN、0 第三方影音 Runtime 套件。
- 64 / 96 / 128 / 192 / 256 / 320 kbps CBR。
- Mono / Stereo。
- 32 / 44.1 / 48 kHz Native MP3。
- 相容 WAV 使用低記憶體分塊串流。
- 其他瀏覽器可解碼格式使用 Web Audio fallback，並先做 PCM 記憶體風險檢查。
- 可輸出到來源同資料夾、`MP3_轉換結果`、自選資料夾，或瀏覽器下載。
- 直接資料夾輸出使用 `.part` 暫存、完整 MP3 frame 驗證、安全提交與 rollback。
- Output / Recovery 7 天 TTL；Directory Handle 30 天。
- 本次輸出清單、只重試失敗、清理本站專用暫存。

## 最簡單的 GitHub Pages 上線方式

**這個新專案預設不需要 `.github`、`.nojekyll`、`.gitignore`。**

1. GitHub 建立新的 Public Repository，建議名稱：`NativeMP3Converter`。
2. 將 ZIP 解壓縮後，直接把裡面的所有檔案與資料夾上傳到 Repository 根目錄。
3. 到 `Settings → Pages`。
4. `Source` 選 **Deploy from a branch**。
5. Branch 選 `main`，Folder 選 `/(root)`。
6. 按 Save，等待 GitHub Pages 部署。

若帳號是 `chopper-coder` 且 Repository 名稱是 `NativeMP3Converter`，網址會是：

```text
https://chopper-coder.github.io/NativeMP3Converter/
```

這個路徑和舊 `/AudioToMP3/` 不同，因此 Service Worker scope 也完全分離。

## Windows 本機

執行 `start_local.bat`，再用瀏覽器開啟 `http://127.0.0.1:8000/`。不要直接以 `file://` 雙擊 `index.html`。

## 本機測試

```text
python scripts/verify_hashes.py
python scripts/static_check.py
python scripts/security_check.py
python scripts/hash_manifest_policy_test.py
node scripts/self_test.mjs
node scripts/adversarial_test.mjs
node scripts/output_ttl_test.mjs
node scripts/dom_boot_test.mjs
node scripts/classic_bundle_boot_test.mjs
node scripts/output_folder_workflow_test.mjs
node scripts/same_folder_workflow_test.mjs
node scripts/picker_id_limit_test.mjs
node scripts/external_codec_test.mjs
```

`external_codec_test.mjs` 只在測試環境有 FFmpeg 時，把它當獨立 decoder 驗證 MP3；正式網站不載入 FFmpeg。


## V1.0.3 啟動修正

V1.0.3 不再讓 GitHub Pages 逐支解析 ES Module 相依鏈。正式頁面改用 `<script defer src="./js/app.bundle.js"></script>`，主程式、解碼、安全輸出、Recovery、WAV streaming 與 Native MP3 encoder 依賴都打包進單一 Classic JavaScript runtime。MP3 Worker 也以本機 Blob Worker 內嵌，不需要另外載入 `encoder-worker.js` 或其 module graph。

因此網站真正運作只依賴 `index.html`、`css/style.css`、`js/boot-check.js`、`js/app.bundle.js` 與 `sw.js`。其餘 `js/*.js` 為可讀原始碼與回歸測試來源，即使某支 source module 沒有被 Service Worker 快取，也不會讓首頁按鈕失效。

## V1.0.3 File System Access Picker ID 修正

Chromium 的 File System Access picker `id` 最長 32 字元。V1.0.2 的「定位單一輸出」與「開啟輸出位置」使用過長 id，會直接拋出 `showDirectoryPicker ... ID cannot be longer than 32 characters`。V1.0.3 將全部 picker id 統一縮短為 `cmp3-v1-*`，並加入自動回歸測試，確保未來所有 picker id 都不超過 32 字元。


## V1.0.4 Same Folder Workflow UX

「與來源音檔放在同一資料夾」現在可以直接選擇，不再要求使用者事前知道什麼是工作資料夾。若目前音檔是透過「選擇音檔」或傳統「匯入資料夾」加入，選取同資料夾輸出時會立即開啟來源資料夾授權。程式會逐筆核對相對路徑、檔名、大小與修改時間；必要時再以檔案指紋比對。只有全部來源都能在使用者授權的資料夾內核對成功，才會把直接寫回權限套用到目前清單。

若目前清單尚未有音檔，選取同資料夾輸出後選擇資料夾，會直接以該資料夾作為來源並掃描。另保留「📂 選擇來源音檔資料夾」按鈕，供想一次完成授權與掃描的使用者使用。
