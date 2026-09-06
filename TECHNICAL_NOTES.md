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

支援 RIFF PCM 8/16/24/32-bit 與 IEEE Float32，1～2 聲道，32/44.1/48 kHz。RF64 與 WAVE_FORMAT_EXTENSIBLE 暫不走 Native streaming path。

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
