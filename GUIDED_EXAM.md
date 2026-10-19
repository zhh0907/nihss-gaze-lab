# Spoken gaze recording and response selection

Start the camera, turn up the sound, then select **Start gaze exam**. The app asks the patient to look straight ahead, as far left as comfortable, and as far right as comfortable. Directions refer to the patient, independent of the camera or preview mirroring. The examiner should present suitable targets; screen edges do not define full gaze range.

This is horizontal-gaze acquisition for NIHSS Best Gaze research, not a validated clinical protocol or a complete NIHSS examination. The examiner must verify audibility, cooperation and examination adequacy. No reflex maneuver is instructed.

## Recording timing

`guided-exam-v4` records actual browser speech-start/end events on the raw-video clock. The first speech request occurs in the recording-button gesture. Queued speech does not label samples. After speech ends, there is a movement allowance of 0.5 seconds for center and 0.75 seconds for either side, followed by a 2.5-second center hold or a 4-second directional hold. Observation starts at the actual speech-start event, so movement during the instruction or allowance is retained too.

The introduction adds 0.5 seconds of preparation. The final unlabelled cue says `Test complete. You can relax.` Recording waits for its speech-end event, then another 0.75 seconds. Completion cannot be cut off by normal automatic-stop cleanup. Total duration is 13.75 seconds plus speech and scheduling delay, typically about 20–25 seconds. The timing revision is stored as `protocolTiming.id = short-spoken-v1`; older v4 recordings retain their recorded durations. These are acquisition limits, not a claim that every patient can respond in time. If a response leaves too little stable evidence before the phase ends, repeat the recording; the app does not invent a completed response.

Browser speech events do not prove the sound was audible or understood. Speech is not included in the video; microphone access is not requested. Missing speech support rejects a guided start. Speech errors, a 7-second start timeout or a 20-second utterance timeout stop the guide. Early stop, a hidden page or a timer interruption longer than 1.5 seconds also preserves an incomplete clip. The app never silently substitutes a completed visual-only test. Capture timestamps remain attached to their source frames even when inference finishes later; alignment is approximate, not hardware exposure timing.

## Automatic response windows

`response-selection.js` uses the original instruction labels. Eye motion never relabels the requested direction, and resting eye offset is not reset to zero. If the response reference or onset is uncertain, visible waiting positions are not described as verified stable responses or used to infer later changes.

1. Inspect the complete observation from speech start through the hold end. Each eye needs sufficient checked tracking, bounded gaps and a visible tail. Waiting is retained as evidence, not discarded as an unusable lead-in.
2. Establish a visible reference: the initial center observation, or the preceding phase's tail. A bounded interval between cues is recorded explicitly. Within the original baseline window, the latest sufficiently long continuous stable run may be used; no gap is bridged and later contradictory visible positions are retained. A change across missing images or an unsupported reference is not a verified slow response.
3. Find each eye's first sustained change. Scan the full phase before marking an eye as having no detected response. One stationary eye remains in the assessment; two stationary eyes are not automatically normal.
4. Find each eye's stable response and the first joint stable window after both detected onsets. Use 1.5 seconds for center and 2 seconds for left/right. The selector does not maximize excursion or search for a more normal-looking result.
5. Check subsequent tracking and changes. An earlier plateau cannot hide later movement or a missing endpoint. If the full-observation gate fails, no valid analysis window is supplied.

Thresholds are experimental engineering parameters, exported in `response.thresholds`; they are not clinical response-time or palsy cutoffs. Low frame rates, blinking, occlusion, tremor or a late response can still make the evidence insufficient.

- **A · Three positions:** evaluates the midpoint of each accepted stable window. The midpoint must be checked, stable and representative of that window's endpoint.
- **B · Response window:** evaluates the whole selected stable window. `fixedWindow:true` means the evaluator does not subtract settling time again or use time cells with an endpoint outside the chosen window. It does not mean the window was fixed before observing the response.

The UI shows **Recorded phases** with Rest/Left/Right buttons, using the original spoken phase times independently of scoring. Each button plays that whole phase in the active eye-motion or video view and stops at its end. Partial phases are labelled. **Details** separately lists accepted scoring windows and per-eye detected onset/stability times on the video clock. Uncertain events are not displayed as verified timings. No manual phase confirmation is required for new guided clips.

Historical v3 clips retain fixed central windows; v1/v2 retain full holds. Unlabelled imported videos retain manual controls. V4 preset `analysisStart`/`analysisEnd` fields are legacy references only and never substitute for a failed response gate.

## Independent and reviewed results

`automatic-assessment.js` uses original checked tracks with automatically flagged eye samples excluded. It ignores clinician findings, manual selections and accepted replacements. A doctor changing a segment choice does not change this baseline.

Optional segment review creates a separate **Reviewed suggestion**. The response gate is recomputed from the reviewed tracks; old/manual selections cannot bypass it. The available choices are **Keep original**, **Use suggested**, **Both need correction** and **Eye closed**, plus Undo. Both need correction queues later annotation without approving either track. Historical visibility decisions remain readable but are no longer offered as a new option.

Reviewed exports require segment decisions. Original recordings remain available. Independent clinician findings produce a separately labelled **Examiner result**, not a model prediction. These experimental video rules do not establish a validated NIHSS score.

## Stored evidence and limits

Review JSON schema `gaze-reviewed-motion-9` preserves raw recording data, speech events, observation boundaries, per-eye onset/stability evidence, quality gates, selected windows, thresholds, automatic results, review choices, assisted results and clinician findings separately. Rejected proposed windows remain diagnostic only; they do not supply scoring evidence.

Raw and original analysis videos remain complete. Saved analysis samples and matching source images are captured together at up to 12 Hz; raw-camera video and live tracking are unchanged. Source images are archived across complete observations, including movement and failed detections. Preparation, queued-cue gaps and the final buffer are outside that archive scope. Buffers appear as **Outside analysis** in reviewed eye-only playback.

The 48 MiB image cache reserves 8 MiB for center and 20 MiB for each side. JPEG settings remain maximum 1280-pixel side and quality 0.94. Each phase can still exhaust its own allocation. Exports report requested, saved and skipped frames, byte totals and reasons separately by phase. Missing archive images are not approved evidence. Download clips and annotation packages before refreshing; storage is in browser memory.

This release has no cloud upload, LLM, VLM or RL training. Tests cover delayed and asymmetric responses, stationary eyes, gaps, later changes, timing boundaries, review isolation, and Chrome recording with synthetic camera input and scripted speech events. Mobile layout checks do not replace physical iPhone/Safari or clinical validation.
