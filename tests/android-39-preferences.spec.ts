import { createHash } from 'node:crypto';
import type { ChainablePromiseElement } from 'webdriverio' with { 'resolution-mode': 'import' };
import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  acknowledgeAppMessage,
  beginCaseJourney,
  openAccountTop,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

/*
 * Preferences expose no checked/selected state to UiAutomator: a chosen option is only drawn in red.
 * Each option's on-screen image is fingerprinted instead; an option's fingerprint changes when it is
 * chosen and returns to the same value when the same state is shown again.
 */
const fingerprint = async (app: AndroidApp, element: WebdriverIO.Element | ChainablePromiseElement) =>
  createHash('md5').update(await app.takeElementScreenshot(await element.elementId)).digest('hex');

const openPreferences = async (app: AndroidApp) => {
  await openAccountTop(app);
  await app.$(id('view_preference')).click();
  await app.$(id('spinnerPref')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Preferences did not open' });
  // Scrolling to the end brings every section from Seat Category down to Save fully on screen.
  for (let swipe = 0; swipe < 2; swipe += 1) {
    await app.execute('mobile: scrollGesture', { left: 80, top: 1200, width: 920, height: 1000, direction: 'down', percent: 1.0 });
  }
  await app.$(id('textView3')).waitForDisplayed({ timeout: 10_000, timeoutMsg: 'Preferences did not show Save' });
};

/** The options this test changes: both seat categories, the first experience and the R15 age rating. */
const options = async (app: AndroidApp) => {
  const [family, general] = await app.$$(id('image_family'));
  const experience = (await app.$$(id('experience_name')))[0];
  // Age ratings are listed G, PG, PG12, PG15, R15, R18 (asserted in the test).
  const r15 = (await app.$$(id('age_rating_name')))[4];
  return { family, general, experience, r15 };
};

const fingerprints = async (app: AndroidApp) => {
  const { family, general, experience, r15 } = await options(app);
  return {
    family: await fingerprint(app, family),
    general: await fingerprint(app, general),
    experience: await fingerprint(app, experience),
    r15: await fingerprint(app, r15),
  };
};

const save = async (app: AndroidApp) => {
  await app.$(id('textView3')).click();
  expect(await acknowledgeAppMessage(app)).toBe('Your preferences have been updated.');
};

const relaunch = async (app: AndroidApp, appPackage: string) => {
  // The default 500 ms wait for the app to stop is too short on a loaded PC.
  await app.execute('mobile: terminateApp', { appId: appPackage, timeout: 10_000 });
  await app.activateApp(appPackage);
  const accountTab = app.$(id('accountFragment'));
  const appMessageOk = app.$(id('positive_btn'));
  await app.waitUntil(async () => {
    if (await appMessageOk.isDisplayed().catch(() => false)) await appMessageOk.click();
    return accountTab.isDisplayed().catch(() => false);
  }, { timeout: 60_000, timeoutMsg: 'The app did not reopen after being closed' });
};

test('AND-39 Preferences', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-39', 'kiosk');

  // 1–2. Every preference section is offered.
  await openAccountTop(app);
  await app.$(id('view_preference')).click();
  await app.$(id('spinnerPref')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Preferences did not open' });
  const location = (await app.$(id('textView21')).getText()).trim();
  expect(location, 'Preferences show a location').toBe('Cinescape 360');
  expect(await app.$(id('text_find_near_location')).isDisplayed()).toBe(true);
  await snap(`AND-39: preferences open with location ${location}`);
  await openPreferences(app);
  const categories = await app.$$(id('category_name')).map(async (name) => (await name.getText()).trim());
  expect(categories).toEqual(['Family', 'General']);
  expect(await app.$$(id('imgSeatSelectiopn')).length, 'Seat Type offers Standard and Premium').toBe(2);
  expect(await app.$$(id('experience_name')).length, 'Experience offers its formats').toBeGreaterThan(0);
  const ageRatings = await app.$$(id('age_rating_name')).map(async (rating) => (await rating.getText()).trim());
  expect(ageRatings).toEqual(['G', 'PG', 'PG12', 'PG15', 'R15', 'R18']);
  const notificationOption = await app.$('android=new UiSelector().textContains("otification")').isExisting();
  if (!notificationOption) {
    test.info().annotations.push({ type: 'finding', description: 'Preferences have no notification options in this APK (the workbook step lists them).' });
  }
  await snap('AND-39: seat category, seat type, experience and age rating sections');

  // 3. Change seat category, experience and age rating, save, reopen the app: the choices are kept.
  const original = await fingerprints(app);
  const { family, general, experience, r15 } = await options(app);
  // Seat category is a single choice: switch to whichever of Family/General is not chosen now.
  await family.click();
  await app.pause(500);
  let categoryTarget: 'family' | 'general' = 'family';
  if ((await fingerprint(app, family)) === original.family) {
    categoryTarget = 'general';
    await general.click();
  }
  const otherCategory = categoryTarget === 'family' ? 'general' : 'family';
  await experience.click();
  await r15.click();
  await app.pause(800);
  const changed = await fingerprints(app);
  expect(changed[categoryTarget], `Choosing ${categoryTarget} highlights it`).not.toBe(original[categoryTarget]);
  expect(changed.experience, 'Tapping an experience changes its selection').not.toBe(original.experience);
  expect(changed.r15, 'Tapping R15 changes its selection').not.toBe(original.r15);
  await snap(`AND-39: ${categoryTarget}, first experience and R15 changed`);
  await save(app);

  await relaunch(app, androidConfig.appPackage);
  await openPreferences(app);
  expect(await fingerprints(app), 'Saved preferences are kept after the app is closed and reopened').toEqual(changed);
  await snap('AND-39: changed preferences kept after reopening the app');

  // 4. Put the original preferences back.
  const restore = await options(app);
  await restore.experience.click();
  await restore.r15.click();
  // The other category was the original choice if choosing the target changed how it looks.
  const otherWasChosen = changed[otherCategory] !== original[otherCategory];
  if (otherWasChosen) await restore[otherCategory].click();
  await app.pause(800);
  const restored = await fingerprints(app);
  expect(restored.experience).toBe(original.experience);
  expect(restored.r15).toBe(original.r15);
  if (otherWasChosen) {
    expect(restored.family).toBe(original.family);
    expect(restored.general).toBe(original.general);
  } else {
    test.info().annotations.push({
      type: 'finding',
      description: `No seat category was chosen at the start; the app cannot clear one once chosen, so ${categoryTarget} stays saved.`,
    });
  }
  await save(app);
  await snap('AND-39: original preferences saved again');
});
