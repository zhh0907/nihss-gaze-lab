# Guided recording and automatic selection

Start the camera, then select **Start exam**. The visible guide runs Get ready → Rest → Look left → Look right and ends recording automatically. Directions always refer to the subject, regardless of camera facing mode or preview mirroring. An examiner should present appropriate targets; the phone screen edges do not define full gaze range. Optional English speech can be disabled in **Setup → Recording & display settings**. Visible cue timing is authoritative; audio is supplementary.

## Timing

The nominal sequence is 3 seconds to prepare, 1 second to move to rest, a 3-second rest hold, 2 seconds to move left, a 3-second left hold, 2 seconds to move right, and a 3-second right hold. Browser scheduling can make the total slightly longer than 17 seconds. This is an acquisition guide, not a validated clinical protocol.

`guided-exam.js` records actual cue transitions on the raw-video clock. Each interval stores `phase`, `start`, `holdStart`, `end` and `completed`; events preserve the cue history. Analysis frames retain the phase at capture even when inference finishes after the next cue. Video alignment is approximate and does not provide hardware frame timestamps.

Keep the page visible. Stopping early, hiding the page, or a timer interruption longer than 1.5 seconds ends the guide. Completed phases remain available; unfinished phases stay incomplete. The system never backfills prompts that were not displayed.

## Selection and review

- **Method A:** selects a stable, checked window representative of the end of each completed hold. Whole-hold and tail coverage checks reject missing extreme-gaze evidence. Selection never prefers movement amplitude, a normal-looking position, or an expected score.
- **Method B:** uses the complete recorded hold from `holdStart` to `end`. It does not crop tracking gaps, blinks, or missing tails to improve the result. The existing temporal rules assess evidence adequacy.
- Instruction labels remain unchanged when the eyes do not move. Resting offset is preserved, and the patient's observed maximum is never normalized into a normal range.

After reviewing suspicious eye segments, inspect the selected phases and tap **Confirm phases**. Use **Adjust** to edit an A position or B boundary. Manual changes remain protected when tracking choices change; **Exam details → Restore automatic selections** explicitly resets them. Missing reliable A positions can remain unselected while B phase timing is confirmed. Inadequate evidence still produces abstention.

Phase confirmation concerns instruction labels and times only. It does not confirm tracking accuracy, patient cooperation, examination adequacy, or an NIHSS score. Changing selections, rerunning the video check, or changing review decisions invalidates confirmation. Older clips without recorded guide timing keep manual selection.

## Data and validation

Original recordings are retained. Review JSON schema `gaze-reviewed-motion-7` includes guide metadata, automatic proposals, supporting sample indices, manual selections and confirmation history. Eye-position corrections and clinical findings remain separate. No RL training, server upload or LLM is involved.

Automated tests cover phase timing, delayed inference, early stopping, missing tails, immobile/abnormal gaze, edit preservation, confirmation invalidation, exports and real Chrome recording. Mobile layouts are checked at 320–768 pixels. These checks establish software behavior, not clinical performance; physical iPhone/Safari validation remains outstanding.
