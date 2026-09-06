# Security / Reliability Audit — V1.0.2 Classic Bundle Boot Hotfix

## 問題來源

V1.0.1 的 HTML 初始狀態停留在「PCM 安全門檻／離線程式快取／瀏覽器暫存空間正在檢查」，且所有操作按鈕無反應。這組症狀代表 `app.js` 沒有執行到 UI 初始化段，而不是三個背景檢查同時卡住。V1.0.1 雖取消 dynamic import，但仍需要瀏覽器先成功抓取並連結 `app.js` 的完整 ES Module graph；任一相依檔案遺失或載入失敗，都會讓 entry module 完全不執行。

## V1.0.2 修正

- 正式 Runtime 改為單一 `js/app.bundle.js` Classic Script。
- 所有主執行緒相依模組在建置時內嵌進 bundle。
- Native MP3 Encoder Worker 亦打包為字串，轉換時建立同源頁面產生的 Blob Worker。
- HTML 不再使用 `type="module"`。
- Runtime 不再含 `import.meta`、module Worker 或動態 import。
- Service Worker 離線白名單縮減為 5 個必要 Runtime 資產。
- CSP 只增加 `worker-src blob:`，未加入 `unsafe-inline` 或 `unsafe-eval`。
- 原始模組保留供閱讀與回歸測試，但不再是首頁啟動的 runtime dependency。

## 安全邊界

音訊仍只在本機瀏覽器處理；Runtime 無 CDN、FFmpeg、WASM、第三方 codec runtime 或遠端轉檔 API。Blob Worker 的內容由同一個 `app.bundle.js` 內建常數產生，不從使用者輸入或網路字串建立程式碼。
