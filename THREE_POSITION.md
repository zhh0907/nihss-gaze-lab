# Method A: three-position evidence

Method A adapts the position-code rule from Honghao's earlier local `NIHSS/index.html`. It uses rest, instructed subject-left and instructed subject-right positions, with both eyes measured independently. Resting offset is retained; no patient-specific zero or maximum-range normalization is applied. These are experimental rules, not a clinically validated NIHSS classifier.

## Selection

For [guided v4 recordings](GUIDED_EXAM.md), `method-selection.js` searches short checked windows representative of the visible phase ending. A is independent of B: it does not require B's sustained window, its midpoint, a pre-cue baseline or a verified response onset. It never ranks candidates by larger excursion or a preferred clinical result.

The selector tests windows of 0.5, 0.35, 0.25 and 0.2 seconds, requiring at least three observed points and 0.15 seconds of visible span. Position stability, endpoint support and conflicting later changes still matter. Brief earlier gaps or confirmed blinks need not reject a clean position window. An unresolved final eye position cannot be replaced by an earlier, more normal-looking position.

`three-position.js` evaluates adjacent checked observations around each selected time, with a maximum radius of 0.25 seconds. The selected eye must be usable near that instant. Gaps, closed eyes and unchecked samples supply no invented position. Each eye retains its own validity, supporting samples and measured median even if the other eye or another phase cannot be assessed.

Historical guided clips keep their recorded selection strategy. Unlabelled imported clips retain manual Rest/Left/Right controls. Original recordings remain unchanged.

## Rule and partial results

The inherited code boundaries are 0.15 and 0.40 in units of half eye width, not degrees. Negative codes denote subject-left. These boundaries have not been clinically calibrated.

- Complete centered rest and full coded movement in both directions can yield **Possible 0**.
- Other sufficiently supported patterns may yield **Possible 1** or **Review 1–2**. Three positions cannot establish a reflex response or definitively assign 2.
- Incomplete evidence yields **Partial**, with available phases and individual-eye measurements, or **No usable evidence**. A missing eye is not treated as centered; no full score is emitted from partial data.

The automatic result uses original checked measurements with flagged eyes excluded. Doctor-selected corrections produce a separate reviewed result. Clinician findings are an independent source, not training labels used by the automatic baseline. JSON preserves raw samples, selections, per-eye status, thresholds and review provenance. No model training or upload occurs.

Synthetic and browser tests verify behavior and mobile layout. They do not establish clinical accuracy or physical iPhone/Safari performance.
