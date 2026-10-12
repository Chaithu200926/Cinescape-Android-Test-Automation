import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  openAccountTop,
  openArea,
  tapElementCenter,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
const arabic = /[؀-ۿ]/;
const read = async (app: AndroidApp, name: string) => (await app.$(id(name)).getText().catch(() => '')).trim();
const left = async (app: AndroidApp, name: string) => (await app.$(id(name)).getLocation()).x;

/** The Home tab's accessible name shows the app language even when its label is hidden. */
const homeTabName = async (app: AndroidApp) => (await app.$(id('homeFragment')).getAttribute('content-desc')) ?? '';

/** Switches the app language from the Account screen's English / عربي switch. */
const setLanguage = async (app: AndroidApp, language: 'Arabic' | 'English') => {
  await openAccountTop(app);
  const isArabic = arabic.test(await homeTabName(app));
  if (isArabic === (language === 'Arabic')) return;
  await app.$(id('image_switcherLang')).click();
  await app.waitUntil(async () => arabic.test(await homeTabName(app).catch(() => '')) === (language === 'Arabic'), {
    timeout: 30_000,
    timeoutMsg: `The app did not switch to ${language}`,
  });
  await app.pause(2_000);
};

/** Labels shown on the main screens, gathered while the app is in one language. */
const visitMainScreens = async (app: AndroidApp, snap: (label: string) => Promise<void>, language: string) => {
  const seen: Record<string, string[]> = {};

  await openArea(app, 'home');
  await app.$(id('home_title')).waitForDisplayed({ timeout: 45_000, timeoutMsg: 'The home sections did not load' });
  seen.home = await app.$$(id('home_title')).map(async (title) => (await title.getText()).trim());
  seen.tabs = await Promise.all(['homeFragment', 'movieFragment', 'foodFragment', 'accountFragment', 'moreFragment']
    .map(async (tab) => (await app.$(id(tab)).getAttribute('content-desc')) ?? ''));
  await snap(`AND-11 ${language}: home`);

  await openArea(app, 'movies');
  await app.$(id('image_now_showing')).waitForDisplayed({ timeout: 45_000, timeoutMsg: 'No movies were listed' });
  seen.movieTabs = await app.$$(id('textView52')).map(async (tab) => (await tab.getText()).trim());
  await app.$(id('image_now_showing')).click();
  await app.$(id('card_day_date')).waitForDisplayed({ timeout: 45_000, timeoutMsg: 'Movie details did not open' });
  await app.pause(1_500);
  seen.movie = [await read(app, 'text_more_info'), await read(app, 'text_day')];
  await snap(`AND-11 ${language}: movie details`);

  // Booking: a later date's first show, the second seat category, one seat, then the payment review and methods.
  await tapElementCenter(app, (await app.$$(id('card_day_date')))[1].$(id('text_date')));
  await app.pause(2_000);
  await tapElementCenter(app, (await app.$$(id('card_scroll')))[0]);
  await app.$(id('select_seat_category')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The showtime did not open seat categories' });
  seen.categories = await app.$$(id('tv_seat_selectiopn')).map(async (name) => (await name.getText()).trim());
  seen.categoryProceed = [await read(app, 'text_proceeds')];
  await (await app.$$(id('tv_seat_selectiopn')))[seen.categories.length - 1].click();
  await app.$(id('text_proceeds')).click();
  await app.$(id('seat_table')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The seat map did not open' });
  await app.$(id('progress')).waitForDisplayed({ reverse: true, timeout: 60_000 });
  for (const cell of await app.$(id('seat_table')).$$('android.widget.TextView')) {
    if (/^\d+$/.test((await cell.getText()).trim()) && await cell.isEnabled()) {
      const { x, y } = await cell.getLocation();
      const { width, height } = await cell.getSize();
      await app.execute('mobile: clickGesture', { x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
      break;
    }
  }
  seen.seatProceed = [await read(app, 'txt_proceed')];
  await snap(`AND-11 ${language}: seat map`);
  await app.$(id('txt_proceed')).click();
  await app.$(id('textPaymentReview')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The payment review did not open' });
  seen.review = [await read(app, 'textPaymentReview'), await read(app, 'text_ticket_price'), await read(app, 'text_time_left')];
  seen.reviewRightToLeft = [String((await left(app, 'textPaymentReview')) > 540)];
  await snap(`AND-11 ${language}: payment review`);
  await app.$(id('txt_proceed')).click();
  await app.$(id('paymentLayout')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The payment methods did not open' });
  seen.payment = [await read(app, 'textView155'), ...await app.$$(id('header_offer_type')).map(async (header) => (await header.getText()).trim())];
  await snap(`AND-11 ${language}: payment methods`);
  await app.$(id('text_cancel')).click();
  await app.$(id('consSure')).click();
  await app.pause(2_000);

  await openAccountTop(app);
  await app.$(id('text_profile_title')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The Account screen did not open' });
  seen.profile = [await read(app, 'text_profile_title'), await read(app, 'text_booking_title'), await read(app, 'text_preference'),
    await read(app, 'text_histoery'), await read(app, 'text_signout'), await read(app, 'text_upcoming_booking')];
  seen.profileRightToLeft = [String((await left(app, 'text_profile_title')) > (await left(app, 'text_preference')))];
  await snap(`AND-11 ${language}: profile`);
  return seen;
};

test('AND-11 Arabic language', async ({ app, snap, androidConfig }) => {
  test.setTimeout(900_000);
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-11', 'kiosk');
  try {
    // 1–2. In Arabic every main screen is translated and laid out right to left.
    await setLanguage(app, 'Arabic');
    expect(await left(app, 'homeFragment'), 'In Arabic the Home tab is on the right').toBeGreaterThan(await left(app, 'moreFragment'));
    const inArabic = await visitMainScreens(app, snap, 'Arabic');
    test.info().annotations.push({ type: 'Arabic labels', description: JSON.stringify(inArabic) });
    for (const [screen, labels] of Object.entries(inArabic)) {
      if (screen.endsWith('RightToLeft')) {
        expect(labels, `${screen} is laid out right to left`).toEqual(['true']);
        continue;
      }
      const untranslated = labels.filter((label) => label && !arabic.test(label));
      expect(untranslated, `${screen} is in Arabic`).toEqual([]);
    }

    // 3. Closing and reopening the app keeps Arabic.
    // The default 500 ms wait for the app to stop is too short on a loaded PC.
    await app.execute('mobile: terminateApp', { appId: 'com.cinescape', timeout: 10_000 });
    await app.activateApp('com.cinescape');
    await app.$(id('homeFragment')).waitForDisplayed({ timeout: 240_000, timeoutMsg: 'The app did not reopen' });
    expect(await homeTabName(app), 'Arabic is kept after reopening').toMatch(arabic);
    await snap('AND-11: Arabic kept after reopening');
  } finally {
    // 4. Back to English (also when a check above failed, so later cases start in English).
    await setLanguage(app, 'English');
  }
  expect(await left(app, 'homeFragment'), 'In English the Home tab is on the left').toBeLessThan(await left(app, 'moreFragment'));
  const inEnglish = await visitMainScreens(app, snap, 'English');
  for (const [screen, labels] of Object.entries(inEnglish)) {
    if (screen.endsWith('RightToLeft')) {
      expect(labels, `${screen} is laid out left to right in English`).toEqual(['false']);
      continue;
    }
    expect(labels.filter((label) => arabic.test(label)), `${screen} returns to English`).toEqual([]);
  }
});
