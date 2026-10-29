Real caption excerpts fetched with yt-dlp --skip-download, 2026-10-29.
No audio or video was downloaded. Original cue text/timing/segmentation preserved.
Each real file contains cues/events with start <90000 ms (first ~90 seconds);
ends are preserved, including a final cue that crosses the excerpt boundary.
VTT/JSON3 pairs use exactly this same start-time selection.

manual.vtt, manual.json3:
https://www.youtube.com/watch?v=k_vu3ECsuhY, manual en-GB.
automatic.vtt, automatic.json3:
https://www.youtube.com/watch?v=MrIzFnU0unk, automatic en-orig.
manual-source-automatic.json3:
https://www.youtube.com/watch?v=k_vu3ECsuhY, automatic en-orig; same first
90 seconds as manual.json3 for the manual/automatic word-count comparison.
JSON3 excerpts retain only events containing segs (window setup is not speech).
VTT excerpts retain the original header and selected cue blocks.

Synthetic files (authored here; not fetched):
empty.vtt, malformed.vtt: empty/malformed caption failures.
gap.vtt: 10 s leading and internal gaps plus trailing silence vs 40 s duration.
past-duration.vtt: starts/ends beyond a 40 s source; start must remain 41000 ms.
es.vtt: Spanish text, markup removal, HTML entity decoding.
mlx.json: fake mlx_whisper segments in seconds with an overlap.
metadata.json: fake yt-dlp metadata with manual and automatic tracks.
no-captions.json: fake metadata with neither track pool populated.
shorts.json: fake metadata with a YouTube Shorts webpage URL.

*.expected.json: checked-in normalized segments for each valid caption/ASR
fixture. Expected fixture text is static; tests never regenerate expectations.
The real automatic format pair has 287 words in either format, the manual pair
255; comparing different talks would be meaningless. The additional automatic
track for the manual source permits a same-source 15% word-count bound.
Malformed/empty fixtures deliberately have no successful expected output.
All fixture files are smaller than 50 KB. Tests require no network or installs.
