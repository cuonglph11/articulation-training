/* TalkFit share video: builds a 9:16 (1080x1920) "reel" from the user's own practice recording,
 * entirely in the browser with a fixed canvas template (no server, no paid API, nothing uploaded).
 *   hook (2 s) -> webcam + prompt + live captions + score panel -> result card with link.
 * Fast path: WebCodecs (VideoEncoder/AudioEncoder) + a tiny muxer loaded from the jsDelivr CDN, runs faster than real time.
 * Fallback: canvas.captureStream + MediaRecorder (real time). Output MP4 if the browser can, else WebM.
 * Public API: window.ShareVideo { panelHTML(L), camLabelHTML(), render(job, onProgress) }. Events: data-sv="make|download|share|copy". */
(function () {
  const LINK = 'https://cuonglph11.github.io/articulation-training/';
  const SHORT = 'cuonglph11.github.io/articulation-training';
  const W = 1080, H = 1920, FPS = 30, HOOK = 2, MAXMAIN = 36, MINTOTAL = 20, OUTRO = 4;
  const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs';
  const WEBM_MUXER = 'https://cdn.jsdelivr.net/npm/webm-muxer@5.0.3/build/webm-muxer.mjs';
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const C = { bg: '#0d1020', panel: '#151a30', line: '#2a3158', violet: '#7c5cff', cyan: '#22d3ee', text: '#e8ebff', muted: '#a9b0dc', ok: '#34d399', near: '#fbbf24', bad: '#f87171' };

  const I = {
    vi: {
      camShare: 'Quay kèm camera để nhận video chia sẻ', camShareNote: 'Tuỳ chọn. Camera và mic chỉ xử lý trên máy bạn, không tải lên đâu cả.',
      title: '🎬 Video chia sẻ của bạn', desc: 'Dựng sẵn dạng dọc 9:16 từ chính phiên luyện này: phụ đề, điểm số, hiển thị rõ giao diện app. Dựng ngay trên máy bạn, không tải lên đâu cả.',
      make: '✨ Tạo video chia sẻ', busy: 'Đang dựng video…', rendered: 'Xong! {s}s · {f} · dựng trong {r}s', download: '⬇ Tải video', share: '📤 Chia sẻ', copy: '📋 Copy caption',
      copied: 'Đã copy caption', err: 'Không dựng được video trên trình duyệt này. Thử Chrome hoặc Safari bản mới.', again: 'Dựng lại', preview: 'Xem thử', capLabel: 'Caption gợi ý (đã kèm hashtag và link)',
      hook: 'Mình vừa luyện nói {d} với TalkFit', hook2: 'Xem điểm ở cuối video 👇', prompt: 'ĐỀ BÀI', score: 'Điểm TalkFit', try: 'Thử miễn phí', tag: 'Luyện nói rõ mỗi ngày', sec: '{n} giây', min: '{n} phút',
      cap: 'Mình vừa luyện nói {d} với TalkFit và được {sc}/100 điểm 🎤\nThử miễn phí, chạy ngay trên trình duyệt: {l}\n{h}', tags: '#TalkFit #luyennoi #giaotiep #thuyettrinh #noiruamoingay'
    },
    en: {
      camShare: 'Record with camera to get a share video', camShareNote: 'Optional. Camera and mic are processed on your device only and never uploaded.',
      title: '🎬 Your share video', desc: 'A ready-made vertical 9:16 video of this session: captions, your score and the app on screen. Built on your device, never uploaded.',
      make: '✨ Create share video', busy: 'Building video…', rendered: 'Done! {s}s · {f} · built in {r}s', download: '⬇ Download', share: '📤 Share', copy: '📋 Copy caption',
      copied: 'Caption copied', err: 'Could not build the video in this browser. Try a recent Chrome or Safari.', again: 'Rebuild', preview: 'Preview', capLabel: 'Suggested caption (hashtags and link included)',
      hook: 'I just practised speaking for {d} with TalkFit', hook2: 'See my score at the end 👇', prompt: 'PROMPT', score: 'TalkFit score', try: 'Try it free', tag: 'Speak clearly, every day', sec: '{n} sec', min: '{n} min',
      cap: 'I just practised speaking for {d} with TalkFit and scored {sc}/100 🎤\nTry it free, runs right in your browser: {l}\n{h}', tags: '#TalkFit #publicspeaking #communicationskills #speakingpractice'
    }
  };
  const ui = () => (typeof S !== 'undefined' && S.ui === 'en') ? 'en' : 'vi';
  const tr = (k, v) => { let s = I[ui()][k]; if (v) for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(b); return s; };
  const track = (n, p) => { try { window.gtag && gtag('event', n, p || {}); } catch { } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = x => 1 - Math.pow(1 - clamp01(x), 3);

  /* ------------------------------ drawing helpers ------------------------------ */
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  function fit(ctx, text, weight, size, maxW) { ctx.font = `${weight} ${size}px ${FONT}`; const w = ctx.measureText(text).width; if (w > maxW) ctx.font = `${weight} ${Math.floor(size * maxW / w)}px ${FONT}`; }
  function skColor(v) { return v >= 80 ? C.ok : v >= 60 ? C.near : C.bad; }
  function grad(ctx, x0, y0, x1, y1) { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, C.violet); g.addColorStop(1, C.cyan); return g; }
  function drawCover(ctx, vid, x, y, w, h, mirror) {
    const vw = vid.videoWidth, vh = vid.videoHeight; if (!vw || !vh) return;
    const s = Math.max(w / vw, h / vh), sw = w / s, sh = h / s, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.save(); rr(ctx, x, y, w, h, 44); ctx.clip();
    if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, w, h); } else ctx.drawImage(vid, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }
  function ring(ctx, cx, cy, r, lw, value, label, big) {
    ctx.save(); ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.strokeStyle = '#232a52'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (value > 0) { ctx.strokeStyle = skColor(value); ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(value / 100)); ctx.stroke(); }
    ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${big ? 150 : 62}px ${FONT}`; ctx.fillText(String(Math.round(value)), cx, cy - (big ? 6 : 2));
    if (label) { ctx.fillStyle = C.muted; ctx.font = `600 ${big ? 34 : 20}px ${FONT}`; ctx.fillText(label, cx, cy + (big ? 92 : 40)); }
    ctx.restore();
  }
  function bars(ctx, x, y, w, rowH, skills, p, fs) {
    skills.forEach(([name, v], i) => {
      const yy = y + i * rowH, val = v * p;
      ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.text; ctx.fillText(name, x, yy + fs * 0.55);
      ctx.textAlign = 'right'; ctx.fillStyle = C.muted; ctx.fillText(String(Math.round(val)), x + w, yy + fs * 0.55);
      const by = yy + fs + 8; rr(ctx, x, by, w, 12, 6); ctx.fillStyle = '#232a52'; ctx.fill();
      if (val > 0) { rr(ctx, x, by, Math.max(12, w * val / 100), 12, 6); ctx.fillStyle = skColor(v); ctx.fill(); }
    });
  }

  /* ------------------------------ captions ------------------------------ */
  function wordTimes(text, vs, ve, D) {
    const ws = String(text || '').split(/\s+/).filter(Boolean); if (!ws.length) return [];
    vs = Math.max(0, Math.min(vs || 0, D - 1)); if (!(ve > vs + 0.5)) ve = Math.max(D, vs + 1);
    const tot = ws.reduce((a, w) => a + w.length + 2, 0); let c = vs;
    return ws.map(w => { const d = (ve - vs) * (w.length + 2) / tot; const o = { w, s: c, e: c + d }; c += d; return o; }).filter(o => o.s < D);
  }
  function chunkWords(wt) {
    const out = []; let cur = [];
    wt.forEach((o, i) => {
      cur.push(o);
      const len = cur.reduce((a, x) => a + x.w.length + 1, 0);
      if (cur.length >= 4 || len > 24 || /[.!?]$/.test(o.w) || i === wt.length - 1) { out.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; }
    });
    return out;
  }
  function drawCaption(ctx, info, tm, cy) {
    let ch = null; for (const c of info.chunks) { if (c.s <= tm) ch = c; else break; }
    if (!ch || tm > ch.e + 0.6) return;
    ctx.save(); ctx.font = `800 64px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    const sp = ctx.measureText(' ').width, ws = ch.words;
    const widths = ws.map(o => ctx.measureText(o.w).width), total = widths.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
    const lines = []; // split into <=2 lines when too wide
    if (total <= 840) lines.push(ws.map((o, i) => i)); else { const half = Math.ceil(ws.length / 2); lines.push(ws.slice(0, half).map((o, i) => i)); lines.push(ws.slice(half).map((o, i) => i + half)); }
    const lh = 80, y0 = cy - (lines.length - 1) * lh / 2;
    lines.forEach((idxs, li) => {
      const lw = idxs.reduce((a, i) => a + widths[i], 0) + sp * (idxs.length - 1); let x = W / 2 - lw / 2;
      idxs.forEach(i => {
        const o = ws[i], active = tm >= o.s && tm < o.e;
        ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(8,10,25,.92)'; ctx.strokeText(o.w, x, y0 + li * lh);
        ctx.fillStyle = active ? C.cyan : '#fff'; ctx.fillText(o.w, x, y0 + li * lh); x += widths[i] + sp;
      });
    });
    ctx.restore();
  }

  /* ------------------------------ frame template ------------------------------ */
  function background(ctx) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(80, 60, 0, 80, 60, 1100); g.addColorStop(0, 'rgba(124,92,255,.38)'); g.addColorStop(1, 'rgba(124,92,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(1000, 1850, 0, 1000, 1850, 1000); g.addColorStop(0, 'rgba(34,211,238,.22)'); g.addColorStop(1, 'rgba(34,211,238,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function brandBar(ctx) { // inside the TikTok/Reels safe area; doubles as the small watermark
    ctx.save(); ctx.fillStyle = grad(ctx, 60, 150, 140, 220); ctx.beginPath(); ctx.arc(92, 190, 32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🗣', 92, 192);
    ctx.textAlign = 'left'; ctx.fillStyle = C.text; ctx.font = `800 46px ${FONT}`; ctx.fillText('TalkFit', 142, 188); ctx.restore();
  }
  function drawFrame(ctx, info, tk, vid) {
    background(ctx); brandBar(ctx);
    const D = info.D, phase = tk < HOOK ? 'hook' : tk < HOOK + D ? 'main' : 'outro', tm = tk - HOOK;
    if (phase !== 'outro') {
      drawCover(ctx, vid, 60, 250, 960, 1040, true);
      // bottom shade for captions
      let g = ctx.createLinearGradient(0, 1000, 0, 1290); g.addColorStop(0, 'rgba(8,10,25,0)'); g.addColorStop(1, 'rgba(8,10,25,.55)');
      ctx.save(); rr(ctx, 60, 250, 960, 1040, 44); ctx.clip(); ctx.fillStyle = g; ctx.fillRect(60, 1000, 960, 290); ctx.restore();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.14)'; rr(ctx, 60, 250, 960, 1040, 44); ctx.stroke();
      // progress line
      const pr = phase === 'main' ? clamp01(tm / D) : 0; rr(ctx, 60, 1304, 960, 8, 4); ctx.fillStyle = '#232a52'; ctx.fill(); if (pr > 0) { rr(ctx, 60, 1304, Math.max(8, 960 * pr), 8, 4); ctx.fillStyle = grad(ctx, 60, 0, 1020, 0); ctx.fill(); }
      // app panel: score ring + skill bars
      const sp = phase === 'main' ? ease((tm - 1) / Math.min(4, Math.max(D - 1, 1))) : 0;
      ctx.save(); rr(ctx, 60, 1330, 960, 205, 30); ctx.fillStyle = 'rgba(21,26,48,.96)'; ctx.fill(); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      ring(ctx, 190, 1430, 78, 16, info.score * sp, tr('score'), false);
      bars(ctx, 330, 1343, 650, 49, info.skills, sp, 24);
    }
    if (phase === 'hook') {
      const k = ease(tk / 0.5); ctx.save(); ctx.fillStyle = 'rgba(8,10,25,.55)'; rr(ctx, 60, 250, 960, 1040, 44); ctx.fill();
      ctx.translate(W / 2, 770); ctx.scale(0.86 + 0.14 * k, 0.86 + 0.14 * k); ctx.globalAlpha = k;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 84px ${FONT}`; ctx.lineJoin = 'round';
      const lines = wrap(ctx, info.hook, 800, 4), lh = 104, y0 = -(lines.length - 1) * lh / 2 - 40;
      lines.forEach((l, i) => { ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(8,10,25,.9)'; ctx.strokeText(l, 0, y0 + i * lh); ctx.fillStyle = '#fff'; ctx.fillText(l, 0, y0 + i * lh); });
      ctx.font = `700 44px ${FONT}`; const sw = ctx.measureText(info.hook2).width + 70, sy = y0 + lines.length * lh + 20;
      rr(ctx, -sw / 2, sy - 36, sw, 72, 36); ctx.fillStyle = grad(ctx, -sw / 2, 0, sw / 2, 0); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(info.hook2, 0, sy + 2);
      ctx.restore();
    } else if (phase === 'main') {
      // prompt card (the "app" content the user practised)
      ctx.save(); ctx.font = `700 40px ${FONT}`; const lines = wrap(ctx, info.topic, 820, 3), ch = 70 + lines.length * 52;
      rr(ctx, 84, 274, 912, ch, 26); ctx.fillStyle = 'rgba(13,16,32,.82)'; ctx.fill(); ctx.strokeStyle = 'rgba(124,92,255,.7)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `800 22px ${FONT}`; ctx.fillStyle = C.cyan; ctx.fillText(tr('prompt'), 112, 306);
      ctx.font = `700 40px ${FONT}`; ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, 112, 354 + i * 52)); ctx.restore();
      drawCaption(ctx, info, tm, 1150);
    } else if (phase === 'outro') {
      const to = tk - HOOK - D, k = ease(to / 0.8);
      ctx.save(); ctx.globalAlpha = clamp01(to / 0.35);
      ctx.textAlign = 'center'; ctx.fillStyle = C.text; ctx.font = `800 56px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText(tr('score'), W / 2, 340);
      ring(ctx, W / 2, 640, 210, 34, info.score * k, ui() === 'en' ? 'out of 100' : 'trên 100', true);
      bars(ctx, 190, 930, 700, 78, info.skills, k, 32);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // CTA
      rr(ctx, 90, 1260, 900, 250, 40); ctx.fillStyle = 'rgba(21,26,48,.96)'; ctx.fill(); ctx.strokeStyle = C.violet; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = C.muted; fit(ctx, tr('try') + ' · ' + tr('tag'), 700, 34, 820); ctx.fillText(tr('try') + ' · ' + tr('tag'), W / 2, 1320);
      fit(ctx, SHORT, 800, 41, 780); const lw = ctx.measureText(SHORT).width + 70; rr(ctx, W / 2 - lw / 2, 1370, lw, 96, 48); ctx.fillStyle = grad(ctx, W / 2 - lw / 2, 0, W / 2 + lw / 2, 0); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(SHORT, W / 2, 1420);
      ctx.restore();
    }
  }

  /* ------------------------------ render pipeline ------------------------------ */
  function buildInfo(job, D) {
    const secs = Math.round(job.speechSec || job.totalSec || D), dur = secs >= 60 ? tr('min', { n: Math.max(1, Math.round(secs / 60)) }) : tr('sec', { n: Math.max(1, secs) });
    const wt = wordTimes(job.transcript, job.voiceStart, job.voiceEnd, D);
    return { D, T: HOOK + D + Math.max(OUTRO, MINTOTAL - HOOK - D), topic: String(job.topic || ''), score: job.score, skills: job.skills, hook: tr('hook', { d: dur }), hook2: tr('hook2'), dur, chunks: chunkWords(wt) };
  }
  async function decodeAudio(blob, rate) {
    const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx(rate ? { sampleRate: rate } : undefined);
    try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } catch { return null; } finally { ctx.close && ctx.close(); }
  }
  function loadVideo(url) {
    return new Promise((res, rej) => {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url; v.setAttribute('playsinline', '');
      const to = setTimeout(() => rej(new Error('video load timeout')), 8000); const res0 = res; res = x => { clearTimeout(to); res0(x); }; v.onerror = () => { clearTimeout(to); rej(new Error('video load')); }; v.onloadeddata = () => { v.onloadeddata = null; const done = () => res(v); v.onseeked = () => { v.onseeked = null; done(); }; try { v.currentTime = 0; } catch { done(); } setTimeout(done, 1500); };
    });
  }
  const makeCanvas = (scale) => { const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale); const ctx = c.getContext('2d'); ctx.scale(scale, scale); return { c, ctx }; };

  async function pickCodecs(scale) {
    if (!('VideoEncoder' in window) || !('AudioEncoder' in window) || !('VideoFrame' in window) || !('AudioData' in window)) return null;
    const w = Math.round(W * scale), h = Math.round(H * scale), bitrate = Math.round(6e6 * scale * scale);
    const tryV = async (codec, extra) => { try { const cfg = { codec, width: w, height: h, bitrate, framerate: FPS, ...extra }; const s = await VideoEncoder.isConfigSupported(cfg); return s.supported ? cfg : null; } catch { return null; } };
    const tryA = async (codec) => { try { const cfg = { codec, sampleRate: 48000, numberOfChannels: 1, bitrate: 96000 }; const s = await AudioEncoder.isConfigSupported(cfg); return s.supported ? cfg : null; } catch { return null; } };
    const [avc, aac] = [await tryV('avc1.640033', { avc: { format: 'avc' } }), await tryA('mp4a.40.2')];
    if (avc && aac) return { kind: 'mp4', v: avc, a: aac };
    for (const vc of ['vp09.00.40.08', 'vp8']) { const v = await tryV(vc), a = await tryA('opus'); if (v && a) return { kind: 'webm', v, a }; }
    return null;
  }

  /* Loudness-normalise the voice (~-14 LUFS for speech), add a quiet synthesised pad (royalty-free, generated in code) and a "ding" at the score reveal, then soft-limit to about -1 dBFS. */
  function mixAudio(pcm, sr, off, D) {
    let ss = 0, n = 0; const end = Math.min(pcm.length, off + Math.round(D * sr));
    for (let i = off; i < end; i++) { const v = pcm[i]; if (Math.abs(v) > 0.01) { ss += v * v; n++; } }
    const rms = n > 1000 ? Math.sqrt(ss / n) : 0, g = rms ? Math.max(0.5, Math.min(8, 0.265 / rms)) : 1;
    const chord = [261.63, 329.63, 392.0, 493.88], T = pcm.length / sr, dingAt = Math.round((HOOK + D + 0.15) * sr);
    for (let i = 0; i < pcm.length; i++) {
      const t = i / sr, fade = Math.min(1, t / 0.6, (T - t) / 1.2); let pad = 0;
      for (let k = 0; k < 4; k++) pad += Math.sin(2 * Math.PI * chord[k] * t + k);
      let x = pcm[i] * g + pad * 0.012 * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t)) * Math.max(0, fade);
      const d = (i - dingAt) / sr; if (d >= 0 && d < 1.2) x += 0.16 * Math.exp(-d * 4) * (Math.sin(2 * Math.PI * 1318.5 * d) + 0.4 * Math.sin(2 * Math.PI * 1976 * d));
      pcm[i] = Math.abs(x) < 0.45 ? x : Math.sign(x) * (0.45 + 0.3 * Math.tanh((Math.abs(x) - 0.45) / 0.3));
    }
  }
  async function renderWebCodecs(job, onProg) {
    const scale = (window.matchMedia && matchMedia('(pointer:coarse)').matches) ? 2 / 3 : 1;
    const codecs = await pickCodecs(scale); if (!codecs) throw new Error('no webcodecs');
    const mod = await import(codecs.kind === 'mp4' ? MP4_MUXER : WEBM_MUXER);
    const buf = await decodeAudio(job.blob, 48000);
    const D = Math.min(MAXMAIN, buf ? buf.duration : job.totalSec || 10), info = buildInfo(job, D), T = info.T, NF = Math.ceil(T * FPS), mainEnd = Math.min(NF, Math.round((HOOK + D) * FPS));
    const url = URL.createObjectURL(job.blob); let vid;
    try {
      vid = await loadVideo(url);
      const target = new mod.ArrayBufferTarget();
      const muxer = new mod.Muxer(codecs.kind === 'mp4'
        ? { target, video: { codec: 'avc', width: codecs.v.width, height: codecs.v.height }, audio: { codec: 'aac', numberOfChannels: 1, sampleRate: 48000 }, fastStart: 'in-memory' }
        : { target, video: { codec: codecs.v.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: codecs.v.width, height: codecs.v.height, frameRate: FPS }, audio: { codec: 'A_OPUS', numberOfChannels: 1, sampleRate: 48000 } });
      let encErr = null;
      const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => { encErr = e; } }); venc.configure(codecs.v);
      const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { encErr = e; } }); aenc.configure(codecs.a);
      const { c, ctx } = makeCanvas(scale); let k = 0;
      const emit = () => { drawFrame(ctx, info, k / FPS, vid); const f = new VideoFrame(c, { timestamp: Math.round(k * 1e6 / FPS), duration: Math.round(1e6 / FPS) }); venc.encode(f, { keyFrame: k % 60 === 0 }); f.close(); k++; if (k % 6 === 0) onProg(0.9 * k / NF); };
      const drain = async () => { while (venc.encodeQueueSize > 10 && !encErr) await new Promise(r => setTimeout(r, 4)); if (encErr) throw encErr; };
      // 1) hook: static first frame
      while (k < Math.round(HOOK * FPS)) { emit(); if (k % 8 === 0) await drain(); }
      // 2) main: play the recording muted at high speed, emit CFR frames as it advances
      vid.currentTime = 0; vid.playbackRate = 3;
      await new Promise((resolve, reject) => {
        let finished = false; const end = () => { if (finished) return; finished = true; resolve(); };
        vid.onended = end; vid.onerror = () => reject(new Error('playback'));
        const step = async (now, meta) => {
          if (finished) return;
          try {
            const m = meta.mediaTime; while (k < mainEnd && k / FPS - HOOK <= m) emit();
            if (k >= mainEnd) return end();
            if (venc.encodeQueueSize > 10) { vid.pause(); await drain(); vid.play().catch(() => { }); }
          } catch (e) { return reject(e); }
          vid.requestVideoFrameCallback(step);
        };
        vid.requestVideoFrameCallback(step); vid.play().catch(reject);
        setTimeout(() => { if (!finished) reject(new Error('playback timeout')); }, (D / 3 + 30) * 1000);
      });
      vid.pause();
      while (k < mainEnd) emit();                         // clip ended slightly early: hold the last frame
      // 3) outro
      while (k < NF) { emit(); if (k % 8 === 0) await drain(); }
      // 4) audio: hook silence + recording + outro silence
      const total = Math.ceil(T * 48000), pcm = new Float32Array(total), off = Math.round(HOOK * 48000);
      if (buf) { const n = buf.numberOfChannels, len = Math.min(buf.length, Math.round(D * 48000)); for (let ch = 0; ch < n; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) pcm[off + i] += d[i] / n; } }
      mixAudio(pcm, 48000, off, D);
      for (let p = 0; p < total; p += 4800) {
        const len = Math.min(4800, total - p); aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: len, numberOfChannels: 1, timestamp: Math.round(p * 1e6 / 48000), data: pcm.subarray(p, p + len) }));
        if (aenc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 4));
      }
      await venc.flush(); await aenc.flush(); if (encErr) throw encErr;
      muxer.finalize(); venc.close(); aenc.close(); onProg(1);
      const mime = codecs.kind === 'mp4' ? 'video/mp4' : 'video/webm';
      return { blob: new Blob([target.buffer], { type: mime }), mime, ext: codecs.kind, seconds: T, path: 'webcodecs', info };
    } finally { URL.revokeObjectURL(url); }
  }

  async function renderRealtime(job, onProg) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('no MediaRecorder');
    const Ctx = window.AudioContext || window.webkitAudioContext, actx = job.actx || new Ctx();   // job.actx is created inside the click handler (iOS only lets an AudioContext start from a user gesture)
    const buf = await decodeAudio(job.blob), D = Math.min(MAXMAIN, buf ? buf.duration : job.totalSec || 10), info = buildInfo(job, D), T = info.T;
    const url = URL.createObjectURL(job.blob);
    try {
      const vid = await loadVideo(url), scale = (window.matchMedia && matchMedia('(pointer:coarse)').matches) ? 2 / 3 : 1, { c, ctx } = makeCanvas(scale);
      const dest = actx.createMediaStreamDestination();
      // one pre-mixed audio buffer covering the whole video (hook + voice + outro): normalised voice, quiet pad, ding
      const sr = actx.sampleRate, pcm = new Float32Array(Math.ceil(T * sr)), off = Math.round(HOOK * sr);
      if (buf) { const n = buf.numberOfChannels, len = Math.min(buf.length, Math.round(D * buf.sampleRate)); for (let ch = 0; ch < n; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) { const j = off + Math.round(i * sr / buf.sampleRate); if (j < pcm.length) pcm[j] += d[i] / n; } } }
      mixAudio(pcm, sr, off, D);
      const abuf = actx.createBuffer(1, pcm.length, sr); abuf.copyToChannel(pcm, 0);
      const src = actx.createBufferSource(); src.buffer = abuf; src.connect(dest);
      const stream = new MediaStream([...c.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const cands = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = cands.find(m => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: Math.round(5e6 * scale * scale), audioBitsPerSecond: 96000 });
      const chunks = []; mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { mr.onstop = r; });
      await Promise.race([actx.resume(), new Promise(r => setTimeout(r, 2000))]);
      if (actx.state !== 'running') throw new Error('audio blocked');
      mr.start(250); src.start();
      const t0 = performance.now(); let started = false;
      await Promise.race([new Promise(resolve => {
        const loop = () => {
          const tk = (performance.now() - t0) / 1000; if (tk >= T) return resolve();
          if (!started && tk >= HOOK) { started = true; vid.currentTime = 0; vid.play().catch(() => { }); }
          drawFrame(ctx, info, tk, vid); onProg(0.98 * tk / T); requestAnimationFrame(loop);
        }; loop();
      }), new Promise((_, rej) => setTimeout(() => rej(new Error('recorder timeout')), (T + 20) * 1000))]);
      vid.pause(); try { mr.stop(); } catch { }
      await Promise.race([stopped, new Promise(r => setTimeout(r, 5000))]); actx.close && actx.close();
      if (chunks.reduce((a, x) => a + x.size, 0) < 5000) throw new Error('empty recording');
      const type = (mr.mimeType || mime || 'video/webm').split(';')[0];
      return { blob: new Blob(chunks, { type }), mime: type, ext: type.includes('mp4') ? 'mp4' : 'webm', seconds: T, path: 'realtime', info };
    } finally { URL.revokeObjectURL(url); }
  }

  async function render(job, onProg) {
    onProg = onProg || (() => { });
    try { return await renderWebCodecs(job, onProg); }
    catch (e) { console.warn('ShareVideo: WebCodecs path unavailable, using real-time recorder:', e && e.message); onProg(0); return renderRealtime(job, onProg); }
  }

  /* Feature probe (never user-agent sniffing): the panel is only shown when this browser can really produce a video file. */
  let support = 'unknown';
  async function probe() {
    try {
      if (!document.createElement('canvas').getContext || !HTMLVideoElement.prototype.play || !(window.AudioContext || window.webkitAudioContext)) return 'no';
      if (await pickCodecs(1)) return 'ok';
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return 'no';
      // real-time path: record 0.6 s from a tiny canvas and require a non-empty file
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
      const mr = new MediaRecorder(c.captureStream(15)), ch = []; mr.ondataavailable = e => e.data.size && ch.push(e.data);
      const done = new Promise(r => { mr.onstop = r; }); mr.start(100);
      let n = 0; const iv = setInterval(() => { g.fillStyle = n++ % 2 ? '#fff' : '#000'; g.fillRect(0, 0, 64, 64); }, 40);
      await new Promise(r => setTimeout(r, 700)); clearInterval(iv); mr.stop(); await Promise.race([done, new Promise(r => setTimeout(r, 2000))]);
      return ch.reduce((a, x) => a + x.size, 0) > 0 ? 'ok' : 'no';
    } catch { return 'no'; }
  }
  const probing = probe().then(r => { support = r; if (r === 'no') { if (typeof S !== 'undefined') S.camShare = false; document.querySelectorAll('.camshare, .svbox').forEach(e => e.remove()); } return r; });

  /* ------------------------------ UI ------------------------------ */
  function jobFrom(L) {
    const r = L.r, A = L.A;
    return { blob: null, url: r.url, topic: L.cfg.topic, transcript: r.transcript, voiceStart: r.voiceStart, voiceEnd: r.voiceEnd, speechSec: r.speech, totalSec: r.total, score: A.overall, skills: Object.entries(A.skills).map(([k, v]) => [(typeof t === 'function' ? t('sk_' + k) : k), v]) };
  }
  function captionFor(L, info) { return tr('cap', { d: info ? info.dur : '', sc: L.A.overall, l: LINK + '?utm_source=user_video&utm_medium=social_share&utm_campaign=viral_loop&utm_content=caption', h: tr('tags') }); }
  function panelHTML(L) {
    if (support !== 'ok' || !L || !L.r || !L.r.isVideo || !L.r.url || !L.A || L.A.tooShort) return '';
    const o = L.sv || {};
    let body;
    if (o.busy) body = `<div class="pbar"><i id="svBar" style="width:${Math.round((o.p || 0) * 100)}%"></i></div><div class="kv" id="svMsg" role="status">${tr('busy')} ${Math.round((o.p || 0) * 100)}%</div>`;
    else if (o.url) body = `<div class="svmeta" role="status">✅ ${esc(tr('rendered', { s: Math.round(o.seconds), f: o.ext.toUpperCase(), r: (o.ms / 1000).toFixed(1) }))}</div>
      <video class="svprev" id="svPrev" playsinline loop src="${o.url}"></video>
      <div class="controls" style="justify-content:center"><button class="btn sm" data-sv="play">▶ ${tr('preview')}</button></div>
      <div class="controls"><button class="btn primary" data-sv="download">${tr('download')}</button>${o.canShare ? `<button class="btn" data-sv="share">${tr('share')}</button>` : ''}<button class="btn" data-sv="copy">${tr('copy')}</button><button class="btn ghost" data-sv="make">${tr('again')}</button></div>
      <label class="svcap">${tr('capLabel')}<textarea readonly rows="4" id="svCap">${esc(o.caption)}</textarea></label>`;
    else body = `<div class="controls"><button class="btn primary" data-sv="make">${tr('make')}</button></div>${o.err ? `<div class="notice err">${tr('err')}</div>` : ''}`;
    return `<div class="svbox" id="svbox"><h3>${tr('title')}</h3><p>${tr('desc')}</p>${body}</div>`;
  }
  const camLabelHTML = () => support === 'no' ? '' : `<label class="chk camshare"><input type="checkbox" id="camShare" ${typeof S !== 'undefined' && S.camShare ? 'checked' : ''}> <span>🎥 ${tr('camShare')}<small>${tr('camShareNote')}</small></span></label>`;

  function refresh(L) { const el = document.getElementById('svbox'); if (el && L) el.outerHTML = panelHTML(L); }
  async function make() {
    const L = typeof curL === 'function' ? curL() : null; if (!L || !L.r || !L.r.url) return;
    if (L.sv && L.sv.busy) return;
    if (L.sv && L.sv.url) URL.revokeObjectURL(L.sv.url);
    let actx = null; try { const Ctx = window.AudioContext || window.webkitAudioContext; actx = new Ctx(); actx.resume(); } catch { }
    L.sv = { busy: true, p: 0 }; refresh(L); track('share_video_start', { mode: L.cfg.kind, lang: L.lang });
    const t0 = performance.now();
    try {
      const job = jobFrom(L); job.actx = actx; job.blob = await (await fetch(L.r.url)).blob();
      let lastP = 0;
      const out = await render(job, p => { L.sv.p = p; if (p - lastP < 0.02 && p < 1) return; lastP = p; const b = document.getElementById('svBar'), m = document.getElementById('svMsg'); if (b) b.style.width = Math.round(p * 100) + '%'; if (m) m.textContent = tr('busy') + ' ' + Math.round(p * 100) + '%'; });
      const ms = performance.now() - t0, file = new File([out.blob], 'talkfit-' + Date.now() + '.' + out.ext, { type: out.mime });
      L.sv = { url: URL.createObjectURL(out.blob), blob: out.blob, file, ext: out.ext, seconds: out.seconds, ms, caption: captionFor(L, out.info), canShare: !!(navigator.canShare && navigator.canShare({ files: [file] })) };
      track('share_video_rendered', { mode: L.cfg.kind, render_ms: Math.round(ms), format: out.ext, path: out.path, seconds: Math.round(out.seconds) });
    } catch (e) { console.error('ShareVideo', e); L.sv = { err: true }; }
    refresh(L);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]'); if (!b) return; const L = typeof curL === 'function' ? curL() : null, a = b.dataset.sv;
    if (a === 'make') return make();
    if (a === 'play') { const v = document.getElementById('svPrev'); if (v) { if (v.paused) { v.currentTime = 0; v.play().catch(() => { }); } else v.pause(); } return; }
    if (!L || !L.sv || !L.sv.blob) return;
    if (a === 'download') { const el = document.createElement('a'); el.href = L.sv.url; el.download = L.sv.file.name; document.body.appendChild(el); el.click(); el.remove(); track('share_video_download', { format: L.sv.ext }); }
    else if (a === 'share') { navigator.share({ files: [L.sv.file], text: L.sv.caption }).then(() => track('share_video_share', { format: L.sv.ext }), () => { }); }
    else if (a === 'copy') { const ta = document.getElementById('svCap'); if (typeof copyText === 'function') copyText(L.sv.caption); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'camShare' && typeof S !== 'undefined') { S.camShare = e.target.checked; if (typeof saveS === 'function') saveS(); } });

  window.ShareVideo = { panelHTML, camLabelHTML, render, tr, probing, supported: () => support === 'ok' };
})();
