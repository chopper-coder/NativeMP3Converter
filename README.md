# 音檔轉 MP3 V1.0｜Fresh GitHub Repository Edition

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
node scripts/bootstrap_contract_test.mjs
node scripts/output_folder_workflow_test.mjs
node scripts/external_codec_test.mjs
```

`external_codec_test.mjs` 只在測試環境有 FFmpeg 時，把它當獨立 decoder 驗證 MP3；正式網站不載入 FFmpeg。
