# Codec references

CHOPPER Native MP3 Core v0.4.1 依 MPEG-1 Layer III 公開格式結構實作，使用 Layer III frame header、side information、analysis window、alias reduction 與 Huffman table 等格式常數。

Repository 不打包也不在 Runtime 動態載入第三方 MP3 encoder library。

測試涵蓋：32 / 44.1 / 48 kHz、64～320 kbps、Mono/Stereo、irregular PCM chunks、WAV streaming、malformed WAV/MP3，以及（測試環境存在時）以 FFmpeg decoder 做獨立相容性 smoke test。FFmpeg 不會部署到 Runtime。
