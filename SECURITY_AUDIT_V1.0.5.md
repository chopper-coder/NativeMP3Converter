# Security Audit — NativeMP3Converter V1.0.5

## Scope

Telephony WAV Compatibility Edition. Runtime remains browser-local, zero CDN, zero FFmpeg runtime, zero WASM and zero third-party runtime package.

## New WAV attack surface review

- RIFF chunk scan remains bounded by header bytes and chunk count.
- WAVE_FORMAT_EXTENSIBLE requires a standard subtype GUID and only PCM / IEEE Float subtypes are accepted.
- G.711 A-law / μ-law require 8-bit samples, 1–2 channels, consistent blockAlign and byteRate.
- Native source sample rate is limited to 8–48 kHz.
- ADPCM and unknown format tags fail closed and report the codec rather than attempting unsafe interpretation.
- Streaming resampler keeps bounded state and does not allocate PCM proportional to total recording duration.
- Existing direct-output `.part`, validation and rollback protections are unchanged.

## Regression coverage

`wav_compatibility_test.mjs` covers 8 kHz PCM, G.711 μ-law, G.711 A-law and WAVE_FORMAT_EXTENSIBLE PCM; each path must produce a structurally valid 32 kHz MP3. Existing malformed-WAV adversarial tests remain enabled.
