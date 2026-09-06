# Security / Reliability Audit — V1.0.3 Picker ID Compatibility Hotfix

## 修正內容

- 修正 Chromium File System Access API `id` 長度上限問題。
- V1.0.2 的 `chopper-native-mp3-v1-locate-item`（33 字元）與 `chopper-native-mp3-v1-locate-output`（35 字元）會讓 `showDirectoryPicker()` 直接拋出例外。
- 全部 picker id 改為短 namespace：`cmp3-v1-*`。
- 新增 `scripts/picker_id_limit_test.mjs`，同時掃描 source 與 classic bundle，要求每個 picker id ≤ 32 字元且只使用英數、`-`、`_`。
- 不變更音訊資料處理、Native MP3 encoder、Recovery TTL、輸出 rollback 與隱私模型。
