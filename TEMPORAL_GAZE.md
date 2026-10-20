# Method B: sustained movement evidence

Method B analyzes instructed rest, subject-left and subject-right observations using elapsed time and independent eye measurements. It is a deterministic research baseline, not a trained or validated NIHSS classifier.

## Independent selection for v4

`method-selection.js` chooses a sustained window representative of each recorded phase. B does not require A's selected position, a verified first movement or the stricter latency diagnostic's full-observation gate. A can have enough short-window evidence while B still lacks a sufficiently sustained hold.

The selector tests windows of 1.5, 1.25, 1.0 and 0.8 seconds, requiring at least 0.7 visible seconds and 75% visible coverage. It distinguishes bounded confirmed blinks from unknown gaps. A supported phase ending and later-change checks remain necessary; a missing extreme-position tail or conflicting later movement cannot be cropped away to obtain a normal result. Selection never maximizes excursion or optimizes a clinical score.

`response-selection.js` remains a separate onset/stability diagnostic. Missing baseline data may prevent a verified latency estimate without preventing B from measuring sustained eye position. Recorded instructions supply direction even when an eye does not move.

## Temporal measurements

`temporal-gaze.js` evaluates each eye independently:

1. Validate ordered, non-overlapping intervals and increasing timestamps. Selected guided windows have no extra settling deduction. Legacy manual/full-hold intervals retain the 0.25-second settling allowance.
2. Count time only between adjacent checked, usable observations at most 0.25 seconds apart. Missing and blinking samples contribute neither positions nor visible duration. Accepted estimates retain their provenance.
3. Calculate duration-weighted positions, signed endpoint quantiles and stable holds. Preserve absolute resting offset and measure directional excursion relative to it.
4. The evaluator requires at least 0.7 valid seconds, 65% usable coverage, no missing run over 0.5 seconds, and 70% coverage in the final 0.5 seconds. The independent selector adds its own stricter window/endpoint checks; these settings are not permission to fill a gap.
5. Require a continuous endpoint hold of at least 0.4 seconds within a normalized band of ±0.12. Rest spread and brief threshold crossings are checked separately.

Experimental movement thresholds remain: full signed position 0.40, directional excursion 0.12, resting offset 0.22 and inter-eye excursion difference 0.18. They use half-eye-width units, not degrees, and require clinical calibration. Versioned thresholds and quality decisions are exported.

## Results

Usable eye/phase measurements and partial excursions remain visible even when another eye or phase is missing. **Partial** gives an availability count without forcing a complete score. A detected limitation remains a movement finding to review; missing tracking is not itself abnormal gaze.

Complete evidence may yield **Possible 0**, **Possible 1** or **Review 1–2**. These are experimental suggestions. Score 2 requires independent clinical evidence; the app never infers a reflex result. The [NIHSS instructions](https://www.ninds.nih.gov/sites/default/files/documents/NIH-Stroke-Scale_updatedFeb2024_508.pdf) remain the examination reference.

Automatic comparison uses original checked tracks with flagged eyes excluded. Reviewed choices are assessed separately and cannot alter the automatic baseline. **Details** preserves each eye's measurements, method-specific issues/cautions and source. Rest/Left/Right playback remains available independently of scoring. There is no required manual phase labelling for new guided clips.

Historical v3 recordings retain their fixed analysis intervals; v1/v2 and unlabelled imported clips keep their legacy paths. Raw recordings, samples and previous choices are not overwritten. Review JSON preserves independent selections, partial status, thresholds and supporting indices. No learning or upload occurs.

Synthetic tests cover missing baselines, blinks, short and long gaps, partial eyes/phases, endpoint loss, later changes and original/reviewed separation. Browser tests check English UI and 320–768 px layouts. Clinical accuracy and physical iPhone/Safari validation remain outstanding.
