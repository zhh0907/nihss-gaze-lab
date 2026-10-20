# Eye Tracking & NIHSS Gaze Lab

Browser-based research tools for binocular tracking, video review, and examiner-led gaze assessment, by [Honghao Zhao](https://zhh0907.github.io/).

**[Open live demo](https://zhh0907.github.io/nihss-gaze-lab/)** · [User guide](https://zhh0907.github.io/nihss-gaze-lab/guide.html)

## Overview

- Track both eyes independently with head-pose compensation and per-eye quality checks.
- Record original video, annotated video, and synchronized eye-position data locally.
- Follow spoken center → full left → full right prompts; automatically compare both assessment methods.
- Review suspicious temporal segments with reversible examiner-selected corrections.
- Export reviewed videos, eye-only visualizations, and JSON/CSV with correction provenance.
- Support clinician-entered NIHSS Best Gaze observations and experimental movement summaries.

**Research prototype:** this is not a clinically validated diagnostic system. Video evidence does not autonomously diagnose gaze palsy or assign abnormal NIHSS scores. The examiner remains responsible for assessment.

## Quick start

1. Open the live demo. Camera access requires HTTPS or localhost.
2. Choose camera/import settings under **Tools → Setup**, then start capture.
3. Turn up the sound and select **Start gaze exam**. Follow the spoken center, full-left and full-right instructions. The center hold lasts 2.5 seconds; left and right holds last 4 seconds each. A spoken completion cue finishes before recording stops. Total duration is typically about 20–25 seconds, depending on the voice. Keep the page visible; left/right refer to the subject.
4. After the local check, **Clips → Eye motion** shows **A · Three positions** and **B · Observation** independently. Partial results retain usable phases and individual eyes. **Details** explains missing evidence. Optional segment review produces a separate assisted result and enables reviewed video exports. Rest/Left/Right buttons play the recorded phases even when no complete score is available. Older unlabeled clips retain manual selection.
5. Download recordings and JSON/CSV before refreshing or closing the page.

For local use, serve this repository with `python -m http.server 8000` and open `http://localhost:8000/`. Preserve `vendor/` and the bundled models. No npm build, API key, or application backend is required.

## Review and exports

Original recordings are preserved in full, including buffers. New guided clips archive images from each spoken cue through the end of its observation, with separate center/left/right memory budgets. Saved analysis samples are capped at 12 Hz; live tracking and raw camera video are unchanged. Only the suspicious eye appears. Tap **Keep original** or **Use suggested**, or choose **Both need correction** or **Eye closed**. Undo is available. Both need correction defers precise annotation until after the patient encounter; it approves neither candidate and excludes the suspect measurements. Eye closed excludes the affected eye throughout the displayed segment. The other eye is unchanged. Additional partial-iris suggestions require current visible iris-edge evidence, multiple stable observations and a nearby clear anchor from the same eye. A 250 ms temporal bridge has floating-point tolerance, without extending its time limit. No supported correction remains blank and is explained under Details. Missing tracking is not normal movement and is not filled with zero.

**Later annotation** lists deferred segments. Use the clip's **Download → Save annotation package → Save ZIP** before closing or refreshing. The package contains the original video, exact archived source frames for deferred segments, candidate eye tracks, decisions and history. It omits clinical and automatic NIHSS scores. It is a handoff package, not a manual annotation editor; no automatic upload, persistent cloud queue, or online model update is implemented. Keep saved packages in approved study storage. Review JSON schema 9 and CSV also preserve choices and pending annotation. A deferred decision completes bedside review but does not become a valid eye measurement or a preference for either track.

Eye-only playback shows normalized horizontal, head-relative iris position, not calibrated 3D eye rotation. MP4/WebM availability depends on the browser. Conversion may alter frame timing; use original recordings and timestamps for frame-sensitive analysis.

For new guided v4 clips, recorded speech bounds the observation. [Method A](THREE_POSITION.md) selects representative short position windows; [Method B](TEMPORAL_GAZE.md) independently evaluates sustained movement. Neither requires the other's selected window or a verified response onset. Bounded blinks and brief gaps need not reject an otherwise supported phase. Missing intervals stay missing; critical gaps, later changes and an unsupported endpoint remain explicit checks. Usable individual-eye results survive an incomplete phase, and usable phases survive an incomplete exam.

Complete experimental evidence can yield **Possible 0**, **Possible 1**, or **Review 1–2**. Otherwise the UI shows **Partial** or **No usable evidence**, not a forced score. Automatic A/B uses original checked tracks with suspicious eyes excluded; it does not consume clinician labels or replacements. Reviewed and examiner-based results remain separate. JSON preserves independent selections, quality checks and thresholds. Historical v3 clips retain fixed windows; v1/v2 retain full-hold behavior. These are unvalidated rules, not a learned third method.

[Guided recording](GUIDED_EXAM.md) records actual speech and hold times. Directions come from instructions, never inferred eye motion. Onset/stability timing is a separate diagnostic: uncertainty there does not erase usable position evidence. Speech errors, page hiding or early stopping preserve an incomplete clip. No manual phase confirmation is required for new guided clips.

## Privacy and limitations

- Camera video and analysis stay in the browser; no LLM or video-upload service is used.
- Tracking compensation and segment-repair thresholds are experimental. Uncalibrated eye positions are not angles.
- Gaze suggestions require usable selected positions (or labelled phases) and examiner review; they cannot exclude subtle palsy. The inherited position thresholds are unvalidated; three positions alone cannot establish score 2.
- Clinical rule mapping depends on examiner observations, including applicable reflex findings.
- Mobile-emulation checks do not establish physical iPhone/Android or Safari performance.

## Repository and deployment

`index.html` is the entry point; `guide.html` documents the workflow. `vendor/` contains dependencies and model assets. See `THIRD_PARTY_NOTICES.txt` for attribution. Keep `.nojekyll` and all assets when deploying to GitHub Pages.

Detailed implementation history is preserved in the [commit history](https://github.com/zhh0907/nihss-gaze-lab/commits/main/).

Run the included algorithm regressions with a current Node.js runtime: `node --test tests/*.test.mjs`. They cover independent selection, brief gaps, partial eyes/phases, absent movement, later position changes and original/reviewed separation. Synthetic tests check software behavior; they do not measure clinical accuracy.
