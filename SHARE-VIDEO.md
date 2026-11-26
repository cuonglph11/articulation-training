# Share video (viral loop)
`share-video.js` builds a 9:16 1080x1920 video (hook 2 s → webcam + prompt + word captions + score panel → result card with link; 20–45 s) from the user's own recording, fully in the browser. No server, no paid API, no upload.
- Opt-in: checkbox "Quay kèm camera để nhận video chia sẻ" on talk cards (Today/Review always film). Panel appears under the result, parallel to the email form (not gated).
- Support probe (feature detection, no UA sniffing): panel and the camera opt-in are hidden when the browser cannot produce a video file. Watchdogs (video load 8 s, recorder T+20 s, empty-file check) so the UI never hangs.
- Fast path: WebCodecs (H.264+AAC → MP4, else VP9/VP8+Opus → WebM) with mp4-muxer 5.1.3 / webm-muxer 5.0.3 (MIT, jsDelivr, loaded on demand). Fallback: canvas.captureStream + MediaRecorder (real time).
- Audio: voice loudness-normalised (~-14 LUFS), soft limiter, small synthesised pad + ding (royalty-free, generated in code).
- Captions: words timed proportionally across the detected voice span (no word-level ASR timestamps).
- GA4: share_video_start / _rendered (render_ms, format, path) / _download / _share. Caption link carries utm_source=user_video&utm_medium=social_share&utm_campaign=viral_loop.
