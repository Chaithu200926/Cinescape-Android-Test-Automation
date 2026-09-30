# Cinescape Android App Automation

UI tests for the **Cinescape Android app** (`com.cinescape`, UAT build). [Playwright Test](https://playwright.dev) is the
test runner and report; the app is driven through [Appium](https://appium.io) with the **UiAutomator2** driver, the
same approach as the kiosk UI project. Every test gets a screenshot per step and a video of the whole flow.

Related projects: web tests (KNCC-Web-Automation), kiosk API tests (CinescapeKiosk-API-Automation) and kiosk UI
tests (Kiosk-UI-13-Test-Automation).

## What is tested

| Test | File | What it does |
|---|---|---|
| **App launch** | [`android-app-launch.spec.ts`](tests/android-app-launch.spec.ts) | Installs the app, waits for it to move from the splash screen to the **Sign in** screen, checks it did not crash and that the User Name, Password, Forgot password? and Skip controls are shown. |

More test cases (sign-in, booking, food, payments) will be added once their details are agreed.

## Requirements (Windows PC, no admin rights needed)

Everything goes into your user folder; nothing has to be on `PATH` (`src/android-config.ts` finds the tools and
builds the environment for Appium and adb).

1. **Node.js** 22 or later.
2. **JDK 17** (e.g. Eclipse Temurin) unpacked under `%LOCALAPPDATA%\Java`, or `JAVA_HOME` set.
3. **Android SDK** under `%LOCALAPPDATA%\Android\Sdk` (or `ANDROID_HOME` set) with these packages:
   `platform-tools`, `emulator`, `build-tools;34.0.0`, `platforms;android-34` and
   `system-images;android-34;google_apis_playstore;x86_64`.
4. **Hardware acceleration** for the emulator: "Windows Hypervisor Platform" (works with Hyper-V / Device Guard on).
   Alternatively connect a phone over USB with USB debugging on.
5. **ffmpeg** unpacked under `%LOCALAPPDATA%\ffmpeg` (or `FFMPEG_DIR` set to the folder with `ffmpeg.exe`), so videos
   longer than 180 s are kept in full.
6. **The app's `.apk` file** (the single file, not an unzipped folder). App builds are shared separately and are
   never committed here.

## Setup

```bash
npm ci                   # Playwright, WebdriverIO, Appium and the UiAutomator2 driver
cp .env.example .env     # then set ANDROID_APK_PATH to the .apk file
```

| Variable | Meaning |
|---|---|
| `ANDROID_APK_PATH` | The `.apk` to install fresh before each test. Empty = test the copy already installed on the device. |
| `ANDROID_AVD` | Emulator to boot. Default `cinescape-pixel` (created automatically, Pixel 6 screen, Android 14). |
| `ANDROID_HEADLESS=1` | Run the emulator without its window. |
| `ANDROID_KEEP_EMULATOR=1` | Leave the emulator running after the tests so the next run starts faster. |
| `ANDROID_VIDEO_SECONDS` | Maximum video length (default 1800). Android records 180 s per clip; longer videos are joined with ffmpeg. |
| `ANDROID_HOME`, `JAVA_HOME`, `FFMPEG_DIR`, `APPIUM_PORT` | Only when the tools are not in the default folders / port 4723 is taken. |

## Run

```bash
npm test          # boots the emulator + Appium if needed, installs the APK, runs the tests
npm run report    # open the report (screenshots + video per test)
npm run typecheck # check the TypeScript code
```

No phone is needed: when no device is connected, the run creates and boots the `cinescape-pixel` emulator and shuts
it down afterwards. A phone connected over USB with USB debugging on is used instead when present.

Output goes to `android-report/` (HTML report) and `android-results/` (JUnit, JSON, text log and `appium.log`).
Screens the app marks as secure (for example payment pages) come out black in screenshots and video; that is
Android's protection, not a test failure.

## Project layout

| Path | Purpose |
|---|---|
| `playwright.config.ts` | Runner settings: one device, one test at a time, reports. |
| `src/android-config.ts` | SDK, JDK, emulator, app and Appium settings (from `.env`), and the tool environment. |
| `src/global-setup.ts` | Creates/boots the emulator and starts Appium when needed; stops what it started. |
| `src/fixtures.ts` | `app` (Appium session, installs the APK, records video) and `snap` (named step with a screenshot). |
| `tests/` | The test files. |
| `reporters/text-reporter.ts` | Plain-text execution log. |

## Troubleshooting

- **Emulator says to disable Hyper-V, or avdmanager complains about `hardware-properties.ini`**: the newer Android CLI
  installer can leave the `emulator` package incomplete (an almost empty `lib` folder). Install the emulator zip from
  Google's download site into `Sdk\emulator` instead. The virtual phone is written by `src/global-setup.ts`, so
  avdmanager is not needed.
- **"ANDROID_APK_PATH points to a missing file"** or install errors: point it at the single `.apk` file. Some shared
  copies have a hidden `.apk.zip` extension; an unzipped APK folder cannot be installed.
- **Appium does not start**: see `android-results/appium.log`; another Appium may already use port 4723.
