VideoSplit Pro — Windows desktop app project

A Windows .exe installer was not compiled in this environment because access to the npm package registry was unavailable. This project includes a GitHub Actions workflow to build the installer on a Windows runner.

BUILD LOCALLY ON WINDOWS
1. Install Node.js LTS from https://nodejs.org.
2. Extract this ZIP.
3. Open Command Prompt in the extracted folder.
4. Run:
   npm install
   npm run dist
5. Find the installer in the dist folder.

BUILD VIA GITHUB ACTIONS (NO LOCAL NODE SETUP)
1. Create a GitHub repository and upload the contents of this folder to it (including the hidden .github folder).
2. Open the repository's Actions tab.
3. Run "Build VideoSplit Pro Windows Installer" with Run workflow, or push to the main branch.
4. When the workflow finishes, open the workflow run and download the "VideoSplit-Pro-Windows-Installer" artifact. It contains the .exe installer.

APP FEATURES
- Native Electron desktop window (no browser tab).
- Fixed-duration or equal-part splitting.
- MP4 and WebM output, quality presets.
- Select output folder and save clips directly to disk.
- Video is processed locally and is not uploaded to a video-processing server.

FIRST RUN
The app downloads a portable FFmpeg build on first use and caches it locally. Internet is needed for this initial engine download. Your video remains on your PC.
