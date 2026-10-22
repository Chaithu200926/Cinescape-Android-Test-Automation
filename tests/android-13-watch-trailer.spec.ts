import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { androidTools } from '../src/android-config';
import { test, expect } from '../src/fixtures';
import { type AndroidApp, enterAsGuest, openFirstMovieDetails } from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

/** Turns the phone to a fixed rotation (0 = portrait, 1 = landscape) with auto-rotate off. */
const rotateDevice = (rotation: 0 | 1) => {
  for (const [key, value] of [['accelerometer_rotation', '0'], ['user_rotation', String(rotation)]]) {
    execFileSync(androidTools.adb, ['shell', 'settings', 'put', 'system', key, value], { env: androidTools.env(), timeout: 20_000 });
  }
};

/** The trailer is an embedded YouTube player whose content UiAutomator cannot read; its picture is fingerprinted instead. */
const playerFrame = async (app: AndroidApp) =>
  createHash('md5').update(await app.takeElementScreenshot(await app.$(id('consVideo')).elementId)).digest('hex');

/**
 * A short trailer (1:14 on UAT, 18 Oct) can play to its end before a check starts; the YouTube player then stands on
 * its end frame with "Replay Video", so the picture no longer changes. Replay restarts it before frames are sampled.
 */
const replayIfEnded = async (app: AndroidApp) => {
  const replay = app.$('//*[@text="Replay Video" or @content-desc="Replay Video"]');
  if (!(await replay.isDisplayed().catch(() => false))) return;
  test.info().annotations.push({ type: 'note', description: 'The trailer had finished before the check; it was replayed.' });
  await replay.click();
  await app.pause(3_000);
};

const expectPlaying = async (app: AndroidApp, when: string) => {
  await replayIfEnded(app);
  const first = await playerFrame(app);
  let latest = first;
  await app.waitUntil(async () => (latest = await playerFrame(app)) !== first, {
    timeout: 15_000,
    interval: 1_500,
    timeoutMsg: `The trailer picture did not change ${when}; it is not playing`,
  });
  expect(latest).not.toBe(first);
};

const openTrailer = async (app: AndroidApp, title: string) => {
  await app.$(id('imageView26')).click();
  await app.$(id('consVideo')).waitForDisplayed({ timeout: 20_000, timeoutMsg: `The trailer for "${title}" did not open its player` });
  // Give the embedded player time to buffer before sampling frames.
  await app.pause(4_000);
};

test('AND-13 Watch trailer', async ({ app, snap }) => {
  await enterAsGuest(app);
  const { title } = await openFirstMovieDetails(app);
  const trailer = app.$(id('imageView26'));
  await trailer.waitForDisplayed({ timeout: 15_000, timeoutMsg: `The trailer control for "${title}" was not displayed` });

  // 1–2. The trailer opens in the app and plays.
  await openTrailer(app, title);
  await expectPlaying(app, 'after opening');
  await snap(`AND-13: trailer for ${title} playing`);

  // 3. Rotating while it plays: the player stays in portrait and keeps playing.
  // Rotation is set through adb: Appium's own request retries for ~10 s against the locked
  // orientation, long enough for the 1–2 minute trailer to run out before playback is checked.
  rotateDevice(1);
  try {
    await app.pause(1_500);
    expect(await app.getOrientation(), 'The trailer player keeps its portrait layout').toBe('PORTRAIT');
    await expectPlaying(app, 'after the phone was rotated');
  } finally {
    rotateDevice(0);
  }
  await snap('AND-13: trailer still playing after the phone was rotated');

  // 4. Closing it returns to the movie, with the player's back arrow or Android Back.
  await app.$(id('imageView38')).click();
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Closing the trailer did not return to movie details' });
  expect((await app.$(id('text_film_house_name')).getText()).trim()).toBe(title.trim());
  await snap(`AND-13: back on ${title} after closing the trailer`);

  await openTrailer(app, title);
  await app.back();
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Android Back from the trailer did not return to movie details' });
  expect((await app.$(id('text_film_house_name')).getText()).trim()).toBe(title.trim());
  await snap(`AND-13: Android Back from the trailer returns to ${title}`);
});
