/* On-device AI worker (module worker). Runs Whisper (speech -> text) and Qwen3 (coaching text)
 * with transformers.js. Nothing is sent to any server: model files are downloaded once from the
 * Hugging Face CDN, cached by the browser (Cache API) and all inference runs locally. */
import { pipeline, env, TextStreamer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends && env.backends.onnx) env.backends.onnx.logSeverityLevel = 4; // silence ORT warnings (they show up as console errors)

const ASR_MODEL = 'onnx-community/whisper-base';
const LLM_MODEL = 'onnx-community/Qwen3-0.6B-ONNX';

let asr = null, llm = null, cfg = null;
const post = (m) => self.postMessage(m);

function progressFor(stage) {
  return (p) => {
    if (p.status === 'progress' || p.status === 'download' || p.status === 'done' || p.status === 'initiate')
      post({ type: 'progress', stage, status: p.status, file: p.file, loaded: p.loaded || 0, total: p.total || 0 });
  };
}

async function init(c) {
  cfg = c;
  const gpu = c.device === 'webgpu';
  if (!asr) {
    asr = await pipeline('automatic-speech-recognition', ASR_MODEL, {
      device: gpu ? 'webgpu' : 'wasm',
      dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
      session_options: { logSeverityLevel: 4 }, progress_callback: progressFor('asr'),
    });
  }
  // The coach (Qwen3-0.6B, q4f16 ~570 MB) only runs on WebGPU with shader-f16. Tested: on WASM it is
  // far too slow and rambles; Qwen2.5-0.5B was incoherent on WebGPU. Without it we still do Whisper ASR.
  const llmOk = gpu && c.f16;
  if (llmOk && !llm) {
    llm = await pipeline('text-generation', LLM_MODEL, {
      device: 'webgpu', dtype: 'q4f16', session_options: { logSeverityLevel: 4 },
      progress_callback: progressFor('llm'),
    });
  }
  cfg.llmDevice = llm ? 'webgpu' : null;
  return { asrDevice: gpu ? 'webgpu' : 'wasm', llmDevice: cfg.llmDevice };
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') {
      post({ id, type: 'ready', info: await init(e.data) });
    } else if (type === 'asr') {
      const out = await asr(e.data.audio, {
        language: e.data.lang === 'vi' ? 'vietnamese' : 'english',
        task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false,
      });
      post({ id, type: 'result', text: (out.text || '').trim() });
    } else if (type === 'coach') {
      if (!llm) throw new Error('coach unavailable');
      const msgs = e.data.messages.map((m, i, a) => i === a.length - 1 ? { ...m, content: m.content + ' /no_think' } : m);
      const streamer = new TextStreamer(llm.tokenizer, {
        skip_prompt: true, skip_special_tokens: true,
        callback_function: (t) => post({ id, type: 'token', text: t }),
      });
      const out = await llm(msgs, {
        max_new_tokens: e.data.maxTokens || 220, do_sample: false, repetition_penalty: 1.12, streamer,
      });
      const last = out[0].generated_text.at(-1);
      post({ id, type: 'result', text: (last.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() });
    }
  } catch (err) {
    post({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
