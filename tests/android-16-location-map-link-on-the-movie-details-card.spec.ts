import { test, expect } from '../src/fixtures';
import { enterAsGuest, openArea, openFirstMovieDetails } from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
const mapsPackage = 'com.google.android.apps.maps';

test('AND-16 Location map link on the movie details card', async ({ app, snap, androidConfig }) => {
  await enterAsGuest(app);

  // 1–2. The movie details card shows the cinema and its address.
  const { title } = await openFirstMovieDetails(app);
  const cinema = app.$(id('cinemaName'));
  await cinema.waitForDisplayed({ timeout: 15_000, timeoutMsg: `No cinema location was displayed for "${title}"` });
  expect((await cinema.getText()).trim()).toBe('Cinescape 360');
  expect((await app.$(id('textView110')).getText()).trim()).toBe('360 Mall, Zahra');
  await snap(`AND-16: ${title} shows Cinescape 360, 360 Mall, Zahra`);

  // The card itself offers no map link: tapping the cinema or its address stays on movie details.
  await cinema.click();
  await app.$(id('textView110')).click();
  await app.pause(3_000);
  expect(await app.getCurrentPackage(), 'Movie details has no map link on the cinema or address').toBe(androidConfig.appPackage);
  test.info().annotations.push({
    type: 'finding',
    description: 'The movie details card has no map link; the cinema map link is under More > Location.',
  });

  // 3. The cinema's map link (More > Location) opens Google Maps at Cinescape 360.
  await openArea(app, 'more');
  await app.$(id('textView36')).waitForDisplayed({ timeout: 20_000, timeoutMsg: 'More did not list the cinema location' });
  // More lists every cinema (Cinescape Ajial joined Cinescape 360 by 11 Oct 2026); each row has a name, address and pin.
  const names = await app.$$(id('textView36')).map(async (name) => (await name.getText()).trim());
  const row = names.indexOf('Cinescape 360');
  expect(row, `More > Location lists Cinescape 360 (listed: ${names.join(', ')})`).toBeGreaterThanOrEqual(0);
  expect((await (await app.$$(id('textView38')))[row].getText()).trim()).toBe('360 Mall, Zahra');
  await snap(`AND-16: More > Location lists ${names.join(', ')}; Cinescape 360 has its map pin`);
  await (await app.$$(id('imageView22')))[row].click();

  try {
    await app.waitUntil(async () => (await app.getCurrentPackage()) === mapsPackage, {
      timeout: 30_000,
      timeoutMsg: 'The map link did not open Google Maps',
    });
    // A fresh emulator shows Maps' one-off sign-in prompt first.
    const skip = app.$('android=new UiSelector().text("SKIP")');
    if (await skip.waitForDisplayed({ timeout: 8_000 }).catch(() => false)) await skip.click();
    const place = app.$('android=new UiSelector().packageName("com.google.android.apps.maps").text("Cinescape 360")');
    await place.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Google Maps did not open on Cinescape 360' });
    const coordinates = (await app.$('android=new UiSelector().textMatches("^\\d+\\.\\d+, \\d+\\.\\d+$")').getText()).trim();
    const [latitude, longitude] = coordinates.split(',').map(Number);
    // 360 Mall, Zahra, Kuwait.
    expect(latitude).toBeCloseTo(29.27, 1);
    expect(longitude).toBeCloseTo(47.99, 1);
    await snap(`AND-16: Google Maps pin on Cinescape 360 (${coordinates})`);

    // 4. Back returns to the app where the link was tapped.
    for (let press = 0; press < 3 && (await app.getCurrentPackage()) !== androidConfig.appPackage; press += 1) {
      await app.back();
      await app.pause(1_500);
    }
    expect(await app.getCurrentPackage()).toBe(androidConfig.appPackage);
    await app.$(id('textView36')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Back from Google Maps did not return to Location' });
    await snap('AND-16: back in Cinescape on the Location screen');
  } finally {
    // Maps keeps running in the background otherwise and slows the emulator for the rest of the run.
    await app.terminateApp(mapsPackage).catch(() => undefined);
  }
});
