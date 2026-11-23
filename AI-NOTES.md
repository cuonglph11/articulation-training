# On-device AI scoring — notes

All AI runs **in the user's browser** (static site, no backend). Voice never leaves the device; only model files are downloaded once (Cache API, ≈780 MB on WebGPU+f16, ≈210 MB WebGPU without f16, ≈80 MB WASM-only).

| Part | Library / model | License | Size | Device |
|---|---|---|---|---|
| Runtime | [transformers.js](https://github.com/huggingface/transformers.js) 3.7.6 (via jsDelivr) + ONNX Runtime Web | Apache-2.0 | – | WebGPU, WASM fallback |
| Speech → text | [onnx-community/whisper-base](https://huggingface.co/onnx-community/whisper-base) (OpenAI Whisper base) | Apache-2.0 / MIT (Whisper) | ≈206 MB (fp32 enc + q4 dec) on WebGPU, ≈77 MB (q8) on WASM | WebGPU → WASM |
| Coach text | [onnx-community/Qwen3-0.6B-ONNX](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX) q4f16 | Apache-2.0 | ≈570 MB | WebGPU + shader-f16 only |

Findings (Chrome 158, Apple GPU): Qwen2.5-0.5B-Instruct was incoherent on WebGPU (q4/q4f16/fp16) and Qwen3-0.6B on WASM was slow and rambled, so the AI feedback box is shown only when WebGPU+f16 is available. Without it, Whisper still replaces the browser (Google/Apple) speech recognition and the per-word scoring/tips work as before.

Files: `ai.js` (client, capability detection, progress, API), `ai-worker.js` (module worker, models). Switching AI off never loads the library.
