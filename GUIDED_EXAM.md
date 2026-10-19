# Spoken gaze recording and automatic assessment

Start the camera, turn up the sound, then select **Start gaze exam**. The app announces an NIH Stroke Scale eye movement test, asks the patient to look straight ahead, as far left as comfortable, and as far right as comfortable. Recording stops automatically. Directions always refer to the patient, independent of camera choice or preview mirroring. The examiner should present suitable targets; phone screen edges do not define full gaze range.

This guides horizontal-gaze acquisition for NIHSS Best Gaze research. It is not the entire NIHSS examination, a validated clinical protocol, or an instruction to perform reflex maneuvers. The examiner must verify that the patient can hear and follow instructions and that the examination is adequate.

## Timing and failure handling

`guided-exam-v2` uses browser speech synthesis by default. The first speech request occurs in the recording-button gesture. Each instruction's actual speech-start and speech-end events are saved on the raw-video clock. A queued instruction does not label captured samples. After the direction cue ends, the app allows 1 second to move to center or 2 seconds to move left/right, then records a 3-second hold. The introduction adds a 3-second preparation period. Total duration is 17 seconds plus speech and scheduling delay, typically about 30 seconds depending on the voice.

Native speech callbacks indicate browser playback progress, not that sound was audible or understood. Speech is not recorded into the video; microphone access is not requested. Missing speech support rejects a guided start. Speech errors, a 7-second start timeout or a 20-second utterance timeout stop the guide; partial recordings remain incomplete. The app never silently substitutes a completed visual-only test.

Keep the page visible. Stopping early, hiding the page, or a timer interruption longer than 1.5 seconds ends the guide. Completed intervals remain available; unfinished phases remain incomplete. Analysis samples retain the phase at capture even if inference finishes later. Clock alignment is approximate, not hardware exposure timing.

## Automatic A/B results

- **A · Three positions:** selects a stable, checked window representative of the end of each completed hold. Whole-hold and tail coverage checks reject missing extreme-gaze evidence. Selection never favors movement amplitude or an expected score.
- **B · Full holds:** analyzes each complete interval from `holdStart` to `end`. It does not crop missing extreme-gaze tails to improve the result.
- Both eyes are tracked independently. Labels remain unchanged even if the eyes do not move. Resting offset is preserved; observed maximum movement is never normalized into a normal range.

After the local video check, new guided clips open **Eye motion** and show both automatic results. No **Confirm phases**, manual position selection, or method switching is required. Rest/Left/Right buttons only seek to recorded phases. Older videos without guide timing retain manual controls because instructions cannot safely be inferred from movement alone.

`automatic-assessment.js` uses original checked tracks and excludes automatically flagged eye samples. It ignores clinician findings, manual phase changes and accepted replacements. Missing evidence produces abstention, never a normal score. The automatic result stays unchanged when a doctor changes a segment choice.

Suspicious-segment review is optional for viewing automatic A/B results. Completing it enables a separate **Reviewed suggestion** and reviewed video exports. Independent clinician findings produce a separately identified **Examiner result**. These are not interchangeable with the automatic baseline. Reviewed exports still require segment decisions; original recordings remain downloadable. Eye-only playback leaves unreviewed suspicious eyes and unchecked samples blank.

## Data and validation

Review JSON schema `gaze-reviewed-motion-8` contains original recording data, guide events and speech metadata, automatic evidence and selections, review choices, assisted evidence, and clinician-entered findings separately. Original samples are preserved. Historical guide-v1 clips are supported; no unlabeled video receives invented phase times. This release has no cloud upload, LLM, VLM or RL training. A third learned method has not been implemented.

Tests cover speech callbacks, gesture activation, delayed speech and inference, interruptions, missing tails, immobile gaze, clinical-label isolation, export provenance and Chrome recording with synthetic camera input. Browser speech events are scripted in these tests. Mobile layout is checked down to 320 pixels. Physical iPhone/Safari audibility and clinical performance still need separate validation.
