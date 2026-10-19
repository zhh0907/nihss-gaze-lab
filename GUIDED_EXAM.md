# Spoken gaze recording and automatic assessment

Start the camera, turn up the sound, then select **Start gaze exam**. The app gives a brief introduction, then asks the patient to look straight ahead, as far left as comfortable, and as far right as comfortable. Recording stops automatically after a final buffer. Directions always refer to the patient, independent of camera choice or preview mirroring. The examiner should present suitable targets; phone screen edges do not define full gaze range.

This guides horizontal-gaze acquisition for NIHSS Best Gaze research. It is not the entire NIHSS examination, a validated clinical protocol, or an instruction to perform reflex maneuvers. The examiner must verify that the patient can hear and follow instructions and that the examination is adequate.

## Timing and failure handling

`guided-exam-v3` uses browser speech synthesis. The first speech request occurs in the recording-button gesture. Each instruction's actual speech-start and speech-end events are saved on the raw-video clock. A queued instruction does not label captured samples. After the direction cue ends, the app allows 1 second to move to center or 2 seconds to move left/right. The introduction has only 0.5 seconds of additional preparation.

| Phase | Recorded hold | Fixed analysis window, relative to hold start |
| --- | --- | --- |
| Center | 4 seconds | +1 to +3 seconds |
| Subject-left | 8 seconds | +2 to +6 seconds |
| Subject-right | 8 seconds | +2 to +6 seconds |

After the right hold, recording continues for 2 seconds with an unlabelled finish cue. Total duration is 27.5 seconds plus speech and scheduling delay, typically 35–45 seconds depending on the voice. The final analysis window ends at least 4 seconds before automatic stop, leaving time for a delayed detector result. Ordinary timer jitter can delay the next cue, but never stretches or relocates the fixed analysis window. Early stopping still marks the recording interrupted.

Native speech callbacks indicate browser playback progress, not that sound was audible or understood. Speech is not recorded into the video; microphone access is not requested. Missing speech support rejects a guided start. Speech errors, a 7-second start timeout or a 20-second utterance timeout stop the guide; partial recordings remain incomplete. The app never silently substitutes a completed visual-only test.

Keep the page visible. Stopping early, hiding the page, or a timer interruption longer than 1.5 seconds ends the guide. Completed intervals remain available; unfinished phases remain incomplete. Analysis samples retain the phase at capture even if inference finishes later. Clock alignment is approximate, not hardware exposure timing.

## Automatic A/B results

- **A · Three positions:** checks the fixed midpoint of each analysis window. It requires a stable, checked local position and adequate whole-window/tail coverage. If the midpoint is missing or does not represent the window endpoint, it abstains rather than moving to another moment.
- **B · Analysis window:** evaluates the entire fixed interval from `analysisStart` to `analysisEnd`, without an extra settling deduction. Both ends of a time cell must lie inside that interval. Missing tracking within the window remains in the coverage denominator; no missing tail is cropped away.
- Both eyes are tracked independently. Labels remain unchanged even if the eyes do not move. Resting offset is preserved; observed maximum movement is never normalized into a normal range.

After the local video check, new guided clips open **Eye motion** and show both automatic results. No **Confirm phases**, manual position selection, or method switching is required. Rest/Left/Right buttons only seek to recorded phases. Older videos without guide timing retain manual controls because instructions cannot safely be inferred from movement alone.

Window timing is set from the instructions before looking at eye positions, not from a detected movement onset. This preserves an instructed left/right phase even when the patient cannot move the eyes. It does not establish that the patient responded on time or reached full excursion. Historical v1/v2 clips retain their original full-hold analysis; buffers are not retrospectively inferred for them.

`automatic-assessment.js` uses original checked tracks and excludes automatically flagged eye samples. It ignores clinician findings, manual phase changes and accepted replacements. Missing evidence produces abstention, never a normal score. The automatic result stays unchanged when a doctor changes a segment choice.

Suspicious-segment review is optional for viewing automatic A/B results. Completing it enables a separate **Reviewed suggestion** and reviewed video exports. Independent clinician findings produce a separately identified **Examiner result**. These are not interchangeable with the automatic baseline. Reviewed exports still require segment decisions; original recordings remain downloadable. Eye-only playback leaves unreviewed suspicious eyes and unchecked samples blank.

## Data and validation

Review JSON schema `gaze-reviewed-motion-9` contains original recording data, guide events and speech metadata, full recorded phase boundaries, fixed analysis boundaries, excluded buffer durations, automatic evidence, review choices, deferred annotation tasks, assisted evidence, and clinician-entered findings separately. Invalid or incomplete v3 windows do not fall back to full-hold analysis.

Raw and original analysis video remain complete. New guided clips save analysis samples at at most 20 Hz; live tracking and raw-camera frame rate are unchanged. This samples the recorded measurements and matching images together, so checked source indices remain consecutive inside each window. Only window images are archived for self-check, using separate budgets of 8 MiB for center and 20 MiB for each side, at the existing maximum 1280-pixel JPEG resolution and quality 0.94. An early phase cannot exhaust the right phase's budget. Exported coverage includes requested/saved/skipped frames, byte counts and per-phase skip reasons. A phase can still exceed its own budget; such data remains missing, not approved. Buffers appear as **Outside analysis** in reviewed eye-only playback.

This release has no cloud upload, LLM, VLM or RL training. A third learned method has not been implemented.

Tests cover speech callbacks, gesture activation, delayed speech and inference, interruptions, missing tails, immobile gaze, clinical-label isolation, export provenance and Chrome recording with synthetic camera input. Browser speech events are scripted in these tests. Mobile layout is checked down to 320 pixels. Physical iPhone/Safari audibility and clinical performance still need separate validation.
