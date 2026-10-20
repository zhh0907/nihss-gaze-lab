# Spoken gaze recording and response selection

Start the camera, turn up the sound, then select **Start gaze exam**. The app asks the patient to look straight ahead, as far left as comfortable, and as far right as comfortable. Directions refer to the patient, independent of the camera or preview mirroring. The examiner should present suitable targets; screen edges do not define full gaze range.

This is horizontal-gaze acquisition for NIHSS Best Gaze research, not a validated clinical protocol or a complete NIHSS examination. The examiner must verify audibility, cooperation and examination adequacy. No reflex maneuver is instructed.

## Recording timing

`guided-exam-v4` records actual browser speech-start/end events on the raw-video clock. The first speech request occurs in the recording-button gesture. Queued speech does not label samples. After speech ends, there is a movement allowance of 0.5 seconds for center and 0.75 seconds for either side, followed by a 2.5-second center hold or a 4-second directional hold. Observation starts at the actual speech-start event, so movement during the instruction or allowance is retained too.

The introduction adds 0.5 seconds of preparation. The final unlabelled cue says `Test complete. You can relax.` Recording waits for its speech-end event, then another 0.75 seconds. Completion cannot be cut off by normal automatic-stop cleanup. Total duration is 13.75 seconds plus speech and scheduling delay, typically about 20–25 seconds. The timing revision is stored as `protocolTiming.id = short-spoken-v1`; older v4 recordings retain their recorded durations. These are acquisition limits, not a claim that every patient can respond in time. If a response leaves too little stable evidence before the phase ends, repeat the recording; the app does not invent a completed response.

Browser speech events do not prove the sound was audible or understood. Speech is not included in the video; microphone access is not requested. Missing speech support rejects a guided start. Speech errors, a 7-second start timeout or a 20-second utterance timeout stop the guide. Early stop, a hidden page or a timer interruption longer than 1.5 seconds also preserves an incomplete clip. The app never silently substitutes a completed visual-only test. Capture timestamps remain attached to their source frames even when inference finishes later; alignment is approximate, not hardware exposure timing.

## Independent A/B selection

Recorded instructions supply the phase labels. Eye movement never changes the requested direction, and resting offset is never reset to zero.

For v4 clips, `method-selection.js` selects evidence separately for each method:

- **A · Three positions** looks for short, checked position windows representative of each phase's visible ending. It does not require B's longer window or a known movement onset.
- **B · Observation** looks for sustained, checked movement evidence within each phase. It evaluates duration, position, coverage and stability independently of A.

Each eye is evaluated separately. A visible eye or completed phase remains available when its counterpart is insufficient. A and B can therefore disagree about evidence availability. A shorter clean position window may support A while B still lacks enough sustained evidence.

Confirmed blinks and brief unknown gaps have different bounded tolerances. Missing samples never contribute a position or visible duration; they are not replaced with zero, interpolated, or counted as successful movement. A visible final position and later-change checks prevent an earlier clean interval from concealing an unsupported endpoint or conflicting later movement. Long gaps remain explicit cautions or exclusions according to their location and the method. No selection optimizes movement amplitude or an expected score.

Current selector settings are exported in `methodThresholds`. A tests short windows from 0.5 down to 0.2 seconds; B tests sustained windows from 1.5 down to 0.8 seconds and requires at least 0.7 visible seconds. These are engineering parameters, not clinical cutoffs. Consult `method-selection.js`, `three-position.js` and `temporal-gaze.js` for the exact versioned rules.

`response-selection.js` separately reports onset and settling diagnostics. Its stricter baseline/full-observation checks do **not** gate A or B. An uncertain onset does not mean absent movement, and a failed timing diagnostic does not erase a measured stable position.

## Display and review

**Recorded phases** plays the original Rest/Left/Right intervals in the active video or eye-motion view, stopping at each boundary. These buttons remain usable without a complete score. No manual phase confirmation is required for new guided clips.

The automatic comparison uses original checked tracks, excluding automatically flagged eyes. It ignores clinician findings, manual choices and accepted replacements. Optional segment decisions produce separate reviewed results; independent clinician findings remain an examiner result. **Details** identifies the source and shows available positions for each eye, independent method selections, missing-evidence reasons and timing diagnostics.

Complete evidence may produce an experimental **Possible 0**, **Possible 1** or **Review 1–2**. Otherwise **Partial** reports usable phases and eyes without inventing a complete score; **No usable evidence** means no supported measurements were available for that method. Tracking failure is neither normal gaze nor proof of palsy.

Historical v3 clips retain recorded fixed windows; v1/v2 retain their full-hold path. Unlabelled imported clips retain manual controls. V4 `analysisStart`/`analysisEnd` fields are legacy references, not a mandatory shared A/B window.

## Stored evidence and limits

Review JSON schema `gaze-reviewed-motion-9` preserves raw recording data, speech events, observation boundaries, per-eye onset/stability diagnostics, independent A/B quality status, partial evidence, selected windows, thresholds, automatic results, review choices, assisted results and clinician findings separately. A window may supply a partial eye measurement without supporting a complete score; its eligibility and exclusions are retained separately.

Raw and original analysis videos remain complete. Saved analysis samples and matching source images are captured together at up to 12 Hz; raw-camera video and live tracking are unchanged. Source images are archived across complete observations, including movement and failed detections. Preparation, queued-cue gaps and the final buffer are outside that archive scope. Valid original motion remains visible in the merged eye-only playback, including recording buffers; unchecked samples remain excluded from scoring.

The 48 MiB image cache reserves 8 MiB for center and 20 MiB for each side. JPEG settings remain maximum 1280-pixel side and quality 0.94. Each phase can still exhaust its own allocation. Exports report requested, saved and skipped frames, byte totals and reasons separately by phase. Missing archive images are not approved evidence. Download clips and annotation packages before refreshing; storage is in browser memory.

This release has no cloud upload, LLM, VLM or RL training. Tests cover delayed and asymmetric responses, stationary eyes, gaps, later changes, timing boundaries, review isolation, and Chrome recording with synthetic camera input and scripted speech events. Mobile layout checks do not replace physical iPhone/Safari or clinical validation.
