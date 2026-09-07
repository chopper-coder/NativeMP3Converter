# GitHub 上傳教學 — NativeMP3Converter V1.0.5

## 建議：建立全新的 Repository

請建立新 Repository，例如：

```text
NativeMP3Converter
```

不要把這包再覆蓋到舊 `AudioToMP3` Repository，這樣可以完全避開舊 Service Worker scope。

## 上傳

將 ZIP 解壓後，把內容上傳到 Repository 根目錄。`index.html` 必須在最外層。

本版刻意不依賴 `.github`、`.nojekyll`、`.gitignore`，所以 GitHub 網頁無法上傳點開頭檔案也不影響網站上線。

## GitHub Pages

`Settings → Pages → Build and deployment`

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

儲存後等待部署即可。

## 第一次開啟

如果 Repository 名稱是 `NativeMP3Converter`：

```text
https://你的帳號.github.io/NativeMP3Converter/
```

新專案使用新的 Service Worker cache / IndexedDB namespace，不會讀取舊 `AudioToMP3` 的續作資料。

### V1.0.4 必看

網站啟動已改成單一 `js/app.bundle.js`，不再依賴十幾支 ES Module 同時載入。請確認 Repository 根目錄至少有：

```text
index.html
css/style.css
js/app.bundle.js
js/boot-check.js
sw.js
```

若這 5 個 Runtime 檔案完整，選擇音檔與資料夾按鈕就能初始化；其餘 `js/*.js` 是原始碼與測試來源。


## 與來源音檔放在同一資料夾

V1.0.4 起，「與來源音檔放在同一資料夾」不再因為先用一般檔案選擇器而鎖住。選取此模式時，網站會直接要求你授權來源資料夾；目前清單中的音檔必須全部核對通過，才會取得寫回權限。若選錯資料夾或取消授權，原始檔不會被變更。
