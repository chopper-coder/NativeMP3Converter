# Codec references

CHOPPER Native MP3 Core v0.4.1 依 MPEG-1 Layer III 公開格式結構實作，使用 Layer III frame header、side information、analysis window、alias reduction 與 Huffman table 等格式常數。

Repository 不打包也不在 Runtime 動態載入第三方 MP3 encoder library。

測試涵蓋：32 / 44.1 / 48 kHz、64～320 kbps、Mono/Stereo、irregular PCM chunks、WAV streaming、malformed WAV/MP3，以及（測試環境存在時）以 FFmpeg decoder 做獨立相容性 smoke test。FFmpeg 不會部署到 Runtime。

## GSM 6.10 / Microsoft WAV format 49

- Microsoft Open Specifications identify `WAVE_FORMAT_GSM610` as format tag `0x0031`: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpeai/8ea102e2-d7ee-49cd-be17-e49313533949
- RFC 3551 §4.5.8 describes GSM 06.10 full-rate speech as 160 samples per 33-octet frame for the standard payload form: https://www.rfc-editor.org/rfc/rfc3551
- ETSI ETS 300 961 / GSM 06.10 specifies the RPE-LTP decoder pipeline used by the Native implementation: https://www.etsi.org/deliver/etsi_i_ets/300900_300999/300961/01_60/ets_300961e01p.pdf

Microsoft WAV format 49 uses a distinct 65-byte, two-frame packing. The runtime decoder in this project is a clean-room JavaScript implementation of the GSM 06.10 decoding pipeline plus the Microsoft WAV block framing required by format tag 49.
