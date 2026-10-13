# Eye Tracking & NIHSS Gaze

An independent English, mobile-friendly research web app by Honghao Zhao.
Once published, visitors open the HTTPS website directly. They do not need
Python, a local server, a GitHub account, or an app installation.

## Mobile workspace

On phones, the app opens directly into a single-screen live workspace. Use **Tools** to open the side panel. Primary controls stay on the main screen. Opening tools does not stop the camera or a recording. Rotate the phone to use the landscape layout.

The live11 screen keeps the video and primary buttons visible, with a short timer during recording and messages only when attention is needed. Eye and head values are collapsed under **Tools → Review → Tracking details**. Live recordings are unlabelled; add phase intervals afterwards in **Eye motion → Exam details**. **Setup** contains camera/import/format options; **Clips** contains replay and downloads; **Review** contains the evidence and examiner form.

## Mobile clip review and eye-only motion (mobile9)

Each clip has visible **Download** and **Delete** actions at the top. Deletion asks for confirmation. Review, Eye motion and Video are separate views. Tap the original or suggested image card to select that track for the current single-eye segment; the selected card is highlighted. Leave unresolved and Undo remain available. The Download sheet contains the exact original video, reviewed video, eye-only video and data, with MP4/WebM options where supported. Original recordings are retained.

Eye motion renders fixed, equally normalized eye-corner lines with independently moving iris dots. It uses the selected head-relative **horizontal** position; no face or head movement is rendered. Both width and screen location are fixed, not measurements of changing anatomical eye length. Missing and blink samples have no dot; accepted estimates are purple. Rendering does not improve the underlying planar pose compensation or make it exact. It is not a calibrated three-dimensional eye rotation or a vertical-gaze test.

After all segment choices, the clip shows an experimental Best Gaze suggestion and reasons using the existing movement thresholds. Adequate labelled center, subject-left and subject-right phases are required for video evidence. A possible 0 is conditional; abnormal movement flags ask the examiner to distinguish 1 from 2 and do not autonomously assign either score. Normal-like movement cannot exclude subtle palsy. The expandable exam context allows actual clip-time phase labels and independent clinician findings. Exact 0/1/2 rule mapping requires an examiner ID and an adequate exam; 2 requires the applicable recorded reflex finding. No reflex or palsy diagnosis is inferred from missing tracking. Clinical scores are explicitly based on the examiner's entries. The original session's assessment is not overwritten.

Eye-only and reviewed exports are enabled after segment review. Choices and phase labels are frozen during encoding; changing them invalidates a prepared download. Review JSON includes the derived samples, phase overrides, clinician entries, suggestion, original movement summary, and count of accepted estimates. CSV retains the per-eye correction provenance. No LLM is used, and videos stay in the browser.

## Temporal segment analysis

After recording, the app fits image-supported iris candidates over the whole sequence with forward/backward dynamic programming in head-relative coordinates. Only suspicious single-eye segments are shown. A paired animated preview uses the same saved detector input for original and proposed tracks. The examiner makes one reversible decision per segment. Unaffected eyes are not shown in the review cards.

Blinks require a high blink score, a narrow opening, and reopening within 650 ms; narrow extreme gaze or sustained closure alone is retained. Blink samples are excluded from review/estimation. The original recording is preserved. Short stable gaps may be estimated only between observed same-eye anchors (at most 250 ms), with stable neighbours and no phase, head, blink or archive break. Partly hidden iris centres also require current image support and reliable same-eye anchors on both sides, at most 1.6 seconds apart; candidates outside the observed position envelope plus a small experimental margin are rejected. No normal excursion or bilateral symmetry is assumed. Long or ambiguous invisible motion remains unresolved. These are experimental thresholds, not validated clinical accuracy.

The Video view redraws original or examiner-selected tracks over the complete raw clip, at the same timeline. Accepted estimates are purple; unresolved samples are unmeasured. MP4/WebM exports snapshot the choices and render locally. The exact original analysis/raw files remain downloadable. Full-video alignment uses approximate raw timestamps; segment crops use exact archived images. The original session's NIHSS entry and original data are unchanged.

Review JSON preserves originals and per-segment/per-eye provenance; CSV includes original, proposed and selected values. Only saved analysis frames are checked (48 MiB archive per clip). Standalone older videos cannot use this workflow. This replaces the previous frame-by-frame self-check and manual short-gap UI. No LLM or image upload is used.

## Unavailable eye positions

The quality5 update removes rejected iris dots from both preview and annotated recordings. A dashed eye guide labelled L ? / R ? and a per-eye reason replace misleading positions. Each valid eye keeps its own live value and trace; the other eye's loss does not reset it. Missing values are never zero-filled, held as valid, or interpolated across gaps. Bilateral examination coverage is still required. JSON includes which eyelid/blink check failed. Detector thresholds and NIHSS mapping are unchanged; this fixes presentation, not extreme-gaze detection accuracy.

## Preview orientation

The front-camera preview is flipped horizontally by default. **Tools → Setup → Recording & display settings → Flip front-camera preview** changes the display while tracking. Markers follow the image with upright L/R labels. Analysis coordinates, saved clips, imported videos and rear-camera orientation are unaffected. The separate input-unmirror setting corrects imported file pixels before analysis.

## Continuous camera tracking

The live3 update adds a 250 ms watchdog for video-frame callbacks and a capped timer fallback. A repeating `mediaTime` no longer blocks analysis. Frames pass through an oriented canvas before worker transfer; bitmap creation has a deadline. Only one inference runs at a time. Routine update counters are hidden from the live screen. Results older than 1.5 seconds are cleared with a tracking-delay message.

Local exports identify the build, browser and per-frame scheduling path. These are browser capture timestamps, not sensor exposure timestamps; timer sampling may repeat a source frame. Synthetic callback-stall tests passed, but physical iPhone Safari verification is still needed.

## Video formats

Choose **MP4** or **WebM** in Setup before recording. Unsupported encoders are disabled based on this browser. In Clips, **Download format** selects the original, MP4, or WebM for either the raw or annotated video. Original downloads preserve the exact recorded file. Conversion runs locally, takes roughly the clip duration, re-encodes at up to 30 fps, and can change frame timing or quality. Tap Save when conversion finishes. Keep the tab visible; cancel leaves originals intact. For frame-sensitive research, use the original recording and its JSON/CSV timestamps. No audio is recorded.

## Publish with the GitHub website

1. Create a new **public** repository, for example `nihss-gaze-lab`. GitHub Free supports
   Pages from public repositories. Choose a different repository for each app.
2. Extract this ZIP. Open the extracted `nihss-gaze-lab` folder and upload its **contents**
   using **Add file → Upload files**. Include the `vendor` and `recordings` folders
   when present. **Do not upload the ZIP itself.** `index.html` must be visible at
   the repository root, not inside an extra enclosing folder. Commit to `main`.
3. Include the empty `.nojekyll` file. If it is hidden by your file explorer,
   use **Add file → Create new file**, name it `.nojekyll`, and commit it.
4. Open **Settings → Pages**. Under **Build and deployment**, choose
   **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. Wait until the Pages deployment succeeds. Settings → Pages shows the real
   **Visit site** link. It normally looks like
   `https://YOUR-USERNAME.github.io/nihss-gaze-lab/`. Keep HTTPS enabled.

The address above is a template, not an already published website. The actual
owner and repository name determine the final URL. Changes uploaded to the
selected branch are published automatically. If the first visit shows a 404,
check the deployment status in Actions and confirm that index.html is at root.

No custom workflow, npm install, backend, API key or secret is required.
All individual files are below the 25 MiB browser-upload limit and each package
contains fewer than 100 files. The simulator replay data is split without
rounding or removing data. Keep the complete folder structure when uploading.
Do not replace model or WASM binaries with Git LFS pointer files.

## Use on a phone

Open the **published HTTPS website**, not the github.com repository page.
Use a current Safari or Chrome browser; if an embedded app browser cannot access
the camera, open the link in the full browser. Tap Start camera and allow camera
access. Select Front or Rear before starting; stop before switching cameras.
Keep the page visible and the screen awake. Keep a fixed orientation during a
recording; start a new clip after changing orientation. Use Tools to open secondary controls and results; the live view stays on the main screen.

Models are downloaded on first use and run locally. Startup depends on network
speed and the phone. Camera video, recordings and analysis stay in the browser;
the app does not upload them to GitHub or another server. Download recordings
before closing or refreshing. Some browsers open downloaded videos in a preview;
use Share → Save to Files if needed. Recording requires MediaRecorder and canvas
capture; unavailable features show an explanatory message.

## App instructions and evidence limits

Open [the user guide](guide.html) for the workflow, measurements and limitations.
This is a research prototype, not a clinically validated diagnostic system.
Existing checks use Chrome mobile emulation; physical iPhone/Android devices and
Safari have not been tested in this environment. Phone inference speed varies.

## Files

- `index.html`: website entry point
- `guide.html`: English user guide
- `vendor/`: local Three.js, MediaPipe SDK, WASM and model files
- `.nojekyll`: publish the files directly
- `MANIFEST.json`: SHA-256 hashes of bundled files
- `THIRD_PARTY_NOTICES.txt`: attribution and third-party licenses

No personal camera captures, patient data or QA videos are included. The
simulator includes attributed public GazeBaseVR excerpts and optional desktop
camera-calibration tools. Those tools are not needed to open or run the website.

## GitHub documentation

- [Create a Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [Configure the publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [Upload limits](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
