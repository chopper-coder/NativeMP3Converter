# Security Audit — NativeMP3Converter V1.0.6

GSM 6.10 WAV Compatibility Edition keeps the runtime browser-local with zero CDN, zero FFmpeg runtime, zero WASM and zero third-party runtime packages.

## Added attack-surface checks

- `WAVE_FORMAT_GSM610` is accepted only as mono 8 kHz with 65-byte blocks and 320 samples per block.
- Truncated or non-aligned GSM data chunks are rejected before decode.
- `fact` sample count is accepted only when positive and no larger than the decoded block capacity.
- Decoder input fields are width-bounded by the 260-bit GSM frame layout.
- Decoder arithmetic uses explicit 16-bit saturation for the ETSI fixed-point pipeline.
- GSM blocks are decoded in bounded streaming groups; the compressed source is not expanded into one whole-file PCM allocation.

## Regression

`node scripts/gsm610_compatibility_test.mjs` verifies the 65-byte MS-GSM packing, a bit-exact independent PCM fixture, 8 kHz → 32 kHz streaming resample, and structurally valid MP3 output.
