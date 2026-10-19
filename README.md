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
3. Turn up the sound and select **Start gaze exam**. Follow the spoken center, full-left and full-right instructions. Recording stops after speech plus movement/hold periods, typically about 30 seconds. Keep the page visible; left/right refer to the subject.
4. After the local check, **Clips → Eye motion** shows automatic **A · Three positions** and **B · Full holds** results without manual phase labels or confirmation. Optional segment review produces a separate assisted result and enables reviewed video exports. Older unlabeled clips retain manual selection.
5. Download recordings and JSON/CSV before refreshing or closing the page.

For local use, serve this repository with `python -m http.server 8000` and open `http://localhost:8000/`. Preserve `vendor/` and the bundled models. No npm build, API key, or application backend is required.

## Review and exports

Original recordings are preserved. Suspicious segments show original and proposed tracks; the examiner can accept, reject, undo, mark an eye closed, or leave a segment unresolved. Accepted estimates are visibly marked and their provenance is retained in exports. Long or ambiguous gaps remain unresolved. Missing tracking is not normal movement and is not filled with zero.

Eye-only playback shows normalized horizontal, head-relative iris position, not calibrated 3D eye rotation. MP4/WebM availability depends on the browser. Conversion may alter frame timing; use original recordings and timestamps for frame-sensitive analysis.

The [three-position method](THREE_POSITION.md) uses short stable windows. The [temporal assessment](TEMPORAL_GAZE.md) uses full labelled holds, per-eye positions, sustained excursions and tracking coverage. Both offer **Possible 0**, **Possible 1**, or **Review 1–2**, with abstention when evidence is insufficient. Automatic A/B uses original checked tracks with suspicious eyes excluded; it does not consume clinician labels or replacements. Reviewed and examiner-based results are identified separately. JSON preserves versions, selections, thresholds and evidence. These are experimental rules without comparative clinical validation. A learned third method is not implemented.

[Guided recording](GUIDED_EXAM.md) records actual speech start/end and hold times. Selection uses instructions, never motion-inferred directions. Method B keeps each full hold; Method A requires supported stable evidence. Speech errors, page hiding or early stopping preserve an incomplete clip. Timing does not prove instructions were heard or that a complete clinical examination occurred. New guided clips require no manual phase confirmation.

## Privacy and limitations

- Camera video and analysis stay in the browser; no LLM or video-upload service is used.
- Tracking compensation and segment-repair thresholds are experimental. Uncalibrated eye positions are not angles.
- Gaze suggestions require usable selected positions (or labelled phases) and examiner review; they cannot exclude subtle palsy. The inherited position thresholds are unvalidated; three positions alone cannot establish score 2.
- Clinical rule mapping depends on examiner observations, including applicable reflex findings.
- Mobile-emulation checks do not establish physical iPhone/Android or Safari performance.

## Repository and deployment

`index.html` is the entry point; `guide.html` documents the workflow. `vendor/` contains dependencies and model assets. See `THIRD_PARTY_NOTICES.txt` for attribution. Keep `.nojekyll` and all assets when deploying to GitHub Pages.

Detailed implementation history is preserved in the [commit history](https://github.com/zhh0907/nihss-gaze-lab/commits/main/).
