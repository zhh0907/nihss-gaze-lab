# Method B: temporal hold assessment

Method B is an experimental alternative to Method A (three selected positions). It analyzes labelled rest, subject-left and subject-right intervals on the same reviewed, head-relative eye track. It is a deterministic rule system, not a trained classifier, reinforcement learning, or a validated NIHSS assessment.

## Response windows (v4)

For new v4 recordings, each spoken cue begins a full observation. `response-selection.js` checks each eye's first response and finds the first jointly stable window (1.5 seconds at center, 2 seconds left/right). A full-observation quality gate, a visible pre-cue reference and a later-change check must pass first. A delayed response can shift this window; missing evidence cannot. An eye that never moves is still included. If no supported stable window fits before the phase ends, the result is insufficient evidence. The `fixedWindow:true` evaluator option means no further settling deduction or boundary extrapolation once this adaptive window has been selected.

## Historical fixed windows (v3)

For historical guided v3 recordings, B evaluates the middle 2 seconds of the 4-second center hold and middle 4 seconds of each 8-second directional hold. Preparation, movement allowance and recording buffers are excluded before evidence is inspected. `fixedWindow:true` removes the extra settling deduction and disallows time cells whose endpoints lie outside the fixed window. Missing evidence within it still causes abstention. v1/v2 recordings and manually labelled legacy clips retain the full-hold behavior. See [guided recording](GUIDED_EXAM.md) for the exact timing and provenance.

## Use

New [spoken guided recordings](GUIDED_EXAM.md) show **B · Response window** alongside A automatically. Windows use recorded instruction timing, verified movement and stability; the whole response must pass tracking checks. Gaps are retained as missing evidence. Rest/Left/Right previews only seek; no phase confirmation is needed. Automatic analysis excludes flagged eyes and does not consume clinician feedback. Completing optional segment review adds a separate assisted suggestion. The app cannot verify cooperation or adequate targets. Rest is an initial observation, not calibration that resets gaze to zero.

Older clips without guide timing retain manual **Start**/**End** controls and a method selector. Use one non-overlapping interval per direction, at least one second long, based on instructions rather than detected motion. **Details** shows coverage and original/reviewed evidence. New guided clips hide these manual controls. Incomplete recordings remain incomplete; repeat the exam rather than infer a missing instruction from eye movement.

## Evidence extraction

`temporal-gaze.js` implements `temporal-holds-v1`:

1. Require strictly increasing clip timestamps and valid, non-overlapping labelled intervals within the clip. Skip the first 0.25 seconds of each hold as a settling period.
2. Analyze the two eyes independently. Only adjacent checked, usable observations at most 0.25 seconds apart support duration. Each pair contributes its interval duration and mean normalized position; no extrapolation covers missing frames. Closed, blinking, unresolved and head-rejected observations cannot supply positions. Accepted estimates are retained as a separate provenance category.
3. Calculate duration-weighted medians and quantiles. For directional holds, use the 90th percentile of the signed position as the robust endpoint. Retain absolute resting offset; derive directional excursion relative to that offset without erasing it.
4. Require at least 0.7 valid seconds, 75% usable coverage, no missing run longer than 0.3 seconds, and at least 70% coverage in the final 0.5 seconds. A missing extreme-position tail therefore prevents an otherwise well-tracked hold from passing.
5. Require a continuous stable endpoint hold of at least 0.4 seconds within a normalized band of ±0.12. A position crossing the full-excursion boundary only briefly is inconclusive. Rest also requires a weighted 10th–90th percentile spread no greater than 0.2. Blinks break continuity but do not become centered or abnormal-gaze samples.
6. Compare the independent eye features using experimental thresholds: full signed position 0.40, directional excursion 0.12, resting offset 0.22, inter-eye excursion difference 0.18. Positions are in half-eye-width units, not degrees. These choices require calibration and validation on separate clinical data; they are not NIHSS cutoffs.

## Outputs

- **Possible 0:** all three holds have sufficient evidence, both eyes sustain movement in both directions, and no research-threshold flag remains. Subtle palsy is not excluded.
- **Possible 1:** sufficient evidence shows a sustained limitation, offset or asymmetry that needs clinical confirmation of partial palsy. Tracking error and task performance remain alternative explanations.
- **Review 1–2:** bilateral non-crossing or conjugate resting offset. This pattern alone does not establish either clinical score.
- **Insufficient evidence:** missing labels, unstable holds or inadequate tracking. This is not a normal score and not evidence of palsy.

All video outputs are suggestions. Exact rule-mapped scores use separately entered clinician findings. In particular, failure to cross the midline does not automatically assign 2, and the system does not infer an oculocephalic reflex result. See the [official NIHSS Best Gaze instructions](https://www.ninds.nih.gov/sites/default/files/documents/NIH-Stroke-Scale_updatedFeb2024_508.pdf).

Published video-gaze work also uses consecutive-frame evidence, including [Pibre et al., 2026](https://www.em-consulte.com/article/1819740/enhancing-pre-hospital-stroke-diagnosis-with-video). This implementation is a separate engineering baseline using elapsed time and per-eye coverage checks; it is not a reproduction of that study or a demonstrated improvement over it. No novelty or clinical accuracy claim is made.

## Provenance and validation

Review JSON schema `gaze-reviewed-motion-9` saves original samples, recorded speech, hold and analysis-window times, both automatic methods with quality exclusions, review choices and assisted evidence separately, plus selections, thresholds and supporting indices. Historical manual-selection provenance remains available for older clips. Source recordings and measurements are not overwritten. Nothing is uploaded.

Automated synthetic fixtures cover different frame rates and cadence, spikes, sustained unilateral restriction, conjugate rest offset, missing extreme-position tails, long gaps, blinks, closure, head rejection, unchecked samples, timing errors, original-data preservation, accepted estimates and clinician-only score 2. Browser checks cover the English controls, method switching, shared timelines, exports and mobile widths from 320 to 768 pixels. These verify software behavior, not clinical accuracy. Physical iPhone/Safari testing and labelled-patient evaluation remain outstanding.
