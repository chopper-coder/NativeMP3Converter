# Security / Reliability Audit — V1.0.4 Same Folder Workflow UX Edition

## Scope

本版只調整來源同資料夾輸出的授權與 UI 流程，不變更 Native MP3 編碼核心。

## Safety properties

- 一般 `<input type=file>` / `webkitdirectory` 仍不被當成父資料夾寫入授權。
- 只有使用者主動操作 `showDirectoryPicker({mode:"readwrite"})` 後，才建立來源資料夾 Handle。
- 已匯入清單會逐筆核對相對路徑、檔名、大小與 lastModified；必要時再以既有強指紋機制比對。
- 只要任一來源無法核對，整批授權失敗，不套用部分寫回權限。
- 選錯資料夾或取消 picker 不會修改來源檔案。
- 直接輸出仍沿用 `.part`、MP3 全檔驗證、safe commit 與 rollback。
- File System Access picker ID 仍全部 <= 32 字元。

## UX change

「與來源音檔放在同一資料夾」在支援 File System Access 的安全環境中可直接選擇。缺少來源資料夾 Handle 時會主動開啟授權流程，並提供獨立「授權來源資料夾」按鈕供取消後重試。
