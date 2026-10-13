# Eye Tracking & NIHSS Gaze

An independent English, mobile-friendly research web app by Honghao Zhao.
Once published, visitors open the HTTPS website directly. They do not need
Python, a local server, a GitHub account, or an app installation.

## Mobile workspace

On phones, the app opens directly into a single-screen live workspace. Use **Tools** to open the side panel. Primary controls stay on the main screen. Opening tools does not stop the camera or a recording. Rotate the phone to use the landscape layout.

Video, independent eye measurements, head pose, phase selection and recording controls remain visible. **Setup** contains camera/import/format options; **Clips** contains replay and downloads; **Review** contains the evidence and examiner form.

## Preview orientation

The front-camera preview is flipped horizontally by default. **Tools → Setup → Flip front-camera preview** changes the display while tracking. Markers follow the image with upright L/R labels. Analysis coordinates, saved clips, imported videos and rear-camera orientation are unaffected. The separate input-unmirror setting corrects source pixels before analysis.

## Continuous camera tracking

The live3 update adds a 250 ms watchdog for video-frame callbacks and a capped timer fallback. A repeating `mediaTime` no longer blocks analysis. Frames pass through an oriented canvas before worker transfer; bitmap creation has a deadline. Only one inference runs at a time. The live status shows update count and recent update rate. Results older than 1.5 seconds are cleared with a tracking-delay message.

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
