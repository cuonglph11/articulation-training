/* AI client: on-device speech recognition + coaching (see ai-worker.js).
 * Public API on window.AI. The model/library is only fetched after the user switches AI on. */
(function () {
  const KEY = 'artic.ai';           // '1' once the user switched AI on
  const LOADED = 'artic.ai.loaded'; // models have been downloaded at least once
  const BUSY = 'artic.ai.busy';   // set while models load; still set on next start => tab was killed (out of memory)
  const MB = { coach: 780, gpu: 210, wasm: 80, tiny: 45 };
  // iPhone/iPad Safari kills tabs at ~1 GB: never WebGPU/LLM there, tiny Whisper only, never auto-start
  const LIGHT = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || (navigator.deviceMemory && navigator.deviceMemory <= 2);
  const crashed = localStorage.getItem(BUSY) === '1';
  if (crashed) { localStorage.removeItem(BUSY); localStorage.removeItem(KEY); } // approx. first-run download (Whisper [+ Qwen3 coach])
  const listeners = [];
  let worker = null, seq = 0, initP = null, stall = null, lastProg = 0;
  const pending = new Map();
  const files = {};                 // file -> {loaded,total}
  const st = {
    enabled: !LIGHT && localStorage.getItem(KEY) === '1',
    state: crashed ? 'error' : 'off',                   // off | loading | ready | error | unsupported
    pct: 0, msg: crashed ? 'CRASH: the previous model load ran out of memory and the tab was closed by the browser' : '', light: LIGHT, device: null, f16: false, support: null, info: null, loadMs: 0,
  };
  const emit = () => listeners.forEach(f => { try { f(st); } catch { } });

  async function detect() {
    if (st.support) return st.support;
    let webgpu = false, f16 = false;
    try {
      if (!LIGHT && navigator.gpu) { const a = await navigator.gpu.requestAdapter(); if (a) { webgpu = true; f16 = a.features.has('shader-f16'); } }
    } catch { }
    const wasm = typeof WebAssembly === 'object' && typeof Worker !== 'undefined';
    st.support = { webgpu, f16, wasm, coach: webgpu && f16, light: LIGHT, mb: LIGHT ? MB.tiny : webgpu && f16 ? MB.coach : webgpu ? MB.gpu : MB.wasm };
    st.device = webgpu ? 'webgpu' : wasm ? 'wasm' : null;
    st.f16 = f16;
    return st.support;
  }

  function send(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, { resolve, reject, onToken: msg.onToken }); delete msg.onToken;
      worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  function onMsg(e) {
    const m = e.data;
    if (m.type === 'progress') {
      lastProg = Date.now();
      files[m.stage + ':' + m.file] = { loaded: m.status === 'done' ? (files[m.stage + ':' + m.file]?.total || m.total) : m.loaded, total: m.total || files[m.stage + ':' + m.file]?.total || 0 };
      let l = 0, t = 0; Object.values(files).forEach(f => { l += f.loaded; t += f.total; });
      const expect = (st.support?.mb || 600) * 1e6;
      st.pct = Math.min(99, Math.round(100 * l / Math.max(t, expect)));
      st.msg = Math.round(l / 1e6) + ' MB';
      emit(); return;
    }
    const p = pending.get(m.id); if (!p) return;
    if (m.type === 'token') { p.onToken && p.onToken(m.text); return; }
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
  }

  async function enable() {
    if (initP) return initP;
    if (!LIGHT) localStorage.setItem(KEY, '1'); st.enabled = true;
    initP = (async () => {
      const sup = await detect();
      if (!sup.wasm) { st.state = 'unsupported'; emit(); throw new Error('unsupported'); }
      st.state = 'loading'; st.pct = 0; st.msg = ''; emit();
      localStorage.setItem(BUSY, '1');
      const t0 = performance.now();
      try {
        worker = new Worker('ai-worker.js', { type: 'module' });
        worker.onmessage = onMsg;
        worker.onerror = (e) => { const err = new Error(e.message || 'worker failed to start (blocked CDN or unsupported browser)'); pending.forEach(p => p.reject(err)); pending.clear(); };
        stall = setInterval(() => { if (st.state === 'loading' && Date.now() - lastProg > 60000) { pending.forEach(p => p.reject(new Error('download stalled — check your connection'))); pending.clear(); } }, 5000);
        lastProg = Date.now();
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
        let r;
        try { r = await send({ type: 'init', device: st.device, f16: sup.f16, light: LIGHT }); }
        catch (e1) {
          if (st.device !== 'webgpu') throw e1;
          // WebGPU present but failing (e.g. Safari/older drivers): retry on WASM instead of giving up
          console.warn('WebGPU init failed, retrying on WASM:', e1.message);
          worker.terminate(); worker = new Worker('ai-worker.js', { type: 'module' }); worker.onmessage = onMsg; pending.clear();
          st.device = 'wasm'; st.support.coach = false; st.support.mb = MB.wasm; lastProg = Date.now();
          r = await send({ type: 'init', device: 'wasm', f16: false });
        }
        st.info = r.info; st.loadMs = performance.now() - t0;
        localStorage.setItem(LOADED, '1'); localStorage.removeItem(BUSY);
        clearInterval(stall); st.state = 'ready'; st.pct = 100; emit();
      } catch (err) {
        clearInterval(stall); localStorage.removeItem(BUSY); st.state = 'error'; st.msg = String(err.message || err); initP = null;
        if (worker) { worker.terminate(); worker = null; }
        emit(); throw err;
      }
    })();
    return initP;
  }

  function disable() {
    localStorage.removeItem(KEY); localStorage.removeItem(BUSY); st.enabled = false; st.state = 'off'; st.pct = 0; initP = null;
    if (worker) { worker.terminate(); worker = null; }
    pending.forEach(p => p.reject(new Error('aborted'))); pending.clear();
    emit();
  }

  async function clearCache() {
    disable();
    try { await caches.delete('transformers-cache'); } catch { }
    localStorage.removeItem(LOADED); Object.keys(files).forEach(k => delete files[k]); emit();
  }

  async function decode(blob) {
    const ab = await blob.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ sampleRate: 16000 });
    try {
      const buf = await ctx.decodeAudioData(ab);
      return buf.getChannelData(0).slice();
    } finally { ctx.close && ctx.close(); }
  }

  async function transcribe(blob, lang) {
    if (st.state !== 'ready') throw new Error('AI not ready');
    const audio = await decode(blob);
    let peak = 0; for (let i = 0; i < audio.length; i += 8) peak = Math.max(peak, Math.abs(audio[i]));
    if (peak < 0.01 || audio.length < 8000) return '';       // silence -> avoid Whisper hallucinations
    const r = await send({ type: 'asr', audio, lang }, [audio.buffer]);
    return r.text;
  }

  async function coach(messages, onToken, maxTokens) {
    if (st.state !== 'ready') throw new Error('AI not ready');
    const r = await send({ type: 'coach', messages, maxTokens, onToken });
    return r.text;
  }

  window.AI = {
    st, detect, enable, disable, clearCache, transcribe, coach,
    ready: () => st.state === 'ready',
    coachReady: () => st.state === 'ready' && !!(st.info && st.info.llmDevice),
    on: (f) => listeners.push(f),
    wasLoaded: () => localStorage.getItem(LOADED) === '1',
  };
})();
