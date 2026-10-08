import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  cancelUnpaidCheckout,
  openFirstMovieDetails,
  selectFutureDateWithShowtimes,
  selectOneSeat,
  tapElementCenter,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

/** The chosen date chip is drawn taller than the others; returns its "Thu 08" style label. */
const selectedDateLabel = async (app: AndroidApp) => {
  const chips = await app.$$(id('card_day_date'));
  let tallest = { height: 0, label: '' };
  for (const chip of chips) {
    const { height } = await chip.getSize();
    if (height > tallest.height) {
      const label = (await chip.$$('android.widget.TextView').map(async (text) => (await text.getText()).trim()))
        .filter(Boolean).join(' ');
      tallest = { height, label };
    }
  }
  return tallest.label;
};

const showtimeLabels = async (app: AndroidApp) =>
  (await app.$$(id('text_times')).map(async (time) => (await time.getText()).trim())).filter(Boolean);

/** Answers the "ARE YOU SURE ? Canceling will reset the booking process." prompt that Back raises mid-booking. */
const expectResetPrompt = async (app: AndroidApp, screen: string) => {
  const subtitle = app.$(id('subtitle'));
  await subtitle.waitForDisplayed({ timeout: 10_000, timeoutMsg: `Back on the ${screen} did not ask before resetting the booking` });
  expect((await subtitle.getText()).trim()).toBe('Canceling will reset the booking process.');
  expect((await app.$(id('title')).getText()).trim()).toBe('ARE YOU SURE ?');
};

/** The app pins its screens to portrait: a landscape request must leave the same screen and content in place. */
const rotateAndExpectNoLoss = async (app: AndroidApp, element: string, expectedText: string) => {
  await app.setOrientation('LANDSCAPE').catch(() => undefined);
  await app.pause(2_000);
  expect(await app.getOrientation(), 'Cinescape keeps its portrait layout when the phone is rotated').toBe('PORTRAIT');
  expect((await app.$(id(element)).getText()).trim()).toBe(expectedText);
  await app.setOrientation('PORTRAIT').catch(() => undefined);
};

test('AND-44 Back navigation and multitasking', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-44', 'kiosk');

  /* Rotating on a main screen keeps the signed-in movie list. */
  const firstTitle = (await app.$(id('text_movie_title')).getText()).trim();
  await rotateAndExpectNoLoss(app, 'text_movie_title', firstTitle);
  await snap('AND-44: movie list unchanged after a rotation request');

  /* Movie details → seat category sheet: Back is ignored, "Cancel & go back" keeps the chosen date. */
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  const timesBefore = await showtimeLabels(app);
  expect(await selectedDateLabel(app)).toBe(dateLabel);
  await tapElementCenter(app, showtimes[0]);
  const categorySheet = app.$(id('select_seat_category'));
  await categorySheet.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The showtime did not open seat categories' });
  await app.back();
  await app.pause(1_500);
  expect(await categorySheet.isDisplayed(), 'Back leaves the seat-category sheet open (it closes via Cancel & go back)').toBe(true);
  await snap('AND-44: seat category sheet stays open on Back');
  await app.$(id('cancelDialog')).click();
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Cancel & go back did not return to movie details' });
  expect((await app.$(id('text_film_house_name')).getText()).trim()).toBe(title);
  expect(await selectedDateLabel(app), 'Movie details keep the chosen date after leaving the category sheet').toBe(dateLabel);
  expect(await showtimeLabels(app)).toEqual(timesBefore);
  await snap(`AND-44: ${title} still on ${dateLabel} after Cancel & go back`);

  /* Seat map: Back asks before resetting; "No" keeps the selected seat, proven by checkout listing it. */
  const { seatRow, seatNumber, progress } = await selectOneSeat(app, snap, 'AND-44');
  const seat = `${seatRow}${seatNumber}`;
  const seatHeading = (await app.$(id('tv_seat_timing_date')).getText()).trim();
  await app.back();
  await expectResetPrompt(app, 'seat map');
  await snap('AND-44: Back on the seat map asks before resetting');
  await app.$(id('negative_btn')).click();
  await app.$(id('seat_table')).waitForDisplayed({ timeout: 10_000, timeoutMsg: '"No" did not return to the seat map' });
  expect((await app.$(id('tv_seat_timing_date')).getText()).trim()).toBe(seatHeading);

  await app.$(id('txt_proceed')).click();
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000, timeoutMsg: 'Checkout did not finish loading' });
  const seatNumberLabel = app.$(id('seatNumber'));
  await seatNumberLabel.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The kept seat did not open the payment review' });
  expect((await seatNumberLabel.getText()).trim(), 'The seat chosen before Back is still the one in checkout').toBe(seat);
  await snap(`AND-44: payment review still holds ${seat}`);

  /* Payment review: Back asks before resetting; "No" stays with the same seat. */
  await app.back();
  await expectResetPrompt(app, 'payment review');
  await app.$(id('negative_btn')).click();
  await seatNumberLabel.waitForDisplayed({ timeout: 10_000, timeoutMsg: '"No" did not return to the payment review' });
  expect((await seatNumberLabel.getText()).trim()).toBe(seat);

  /* Payment review survives a rotation request, switching to another app, and locking the phone. */
  await rotateAndExpectNoLoss(app, 'seatNumber', seat);
  const timer = app.$(id('textView111'));
  await app.execute('mobile: backgroundApp', { seconds: 5 });
  await app.activateApp(androidConfig.appPackage);
  await seatNumberLabel.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The payment review did not resume after switching apps' });
  expect((await seatNumberLabel.getText()).trim()).toBe(seat);
  expect((await timer.getText()).trim(), 'The hold timer is still running after switching apps').toMatch(/^\d{2}:\d{2}$/);
  await snap(`AND-44: payment review resumed after switching apps (time left ${(await timer.getText()).trim()})`);

  await app.lock();
  await app.pause(3_000);
  expect(await app.isLocked()).toBe(true);
  await app.unlock();
  await seatNumberLabel.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The payment review did not resume after unlocking' });
  expect(await app.getCurrentPackage()).toBe(androidConfig.appPackage);
  expect((await seatNumberLabel.getText()).trim()).toBe(seat);
  await snap(`AND-44: payment review resumed after lock/unlock (time left ${(await timer.getText()).trim()})`);

  /* Leaving with "Yes, I'm Sure" releases the hold and returns to the same movie and date. */
  await cancelUnpaidCheckout(app);
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Leaving checkout did not return to movie details' });
  expect((await app.$(id('text_film_house_name')).getText()).trim()).toBe(title);
  expect(await selectedDateLabel(app)).toBe(dateLabel);
  await snap(`AND-44: back on ${title} (${dateLabel}) after leaving checkout`);

  /* Force-close and reopen: the customer is still signed in. */
  await app.terminateApp(androidConfig.appPackage);
  expect(await app.queryAppState(androidConfig.appPackage), 'The app process was stopped').toBe(1);
  await app.activateApp(androidConfig.appPackage);
  const accountTab = app.$(id('accountFragment'));
  const signIn = app.$(id('btn_sign_in'));
  const appMessageOk = app.$(id('positive_btn'));
  await app.waitUntil(async () => {
    if (await appMessageOk.isDisplayed().catch(() => false)) await appMessageOk.click();
    return (await accountTab.isDisplayed().catch(() => false)) || (await signIn.isDisplayed().catch(() => false));
  }, { timeout: 60_000, timeoutMsg: 'The app did not reopen after being force-closed' });
  expect(await signIn.isDisplayed().catch(() => false), 'Reopening after a force-close does not ask to sign in again').toBe(false);
  await accountTab.click();
  const accountName = app.$(id('text_user_account_name'));
  await accountName.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Account did not show the signed-in customer after reopening' });
  expect((await accountName.getText()).trim()).not.toBe('');
  await snap(`AND-44: still signed in as ${(await accountName.getText()).trim()} after a force-close`);
});
