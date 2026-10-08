import { expect, test } from '../src/fixtures';
import {
  beginCaseJourney,
  openFirstMovieDetails,
  selectFutureDateWithShowtimes,
  tapElementCenter,
  tapNativeElementCenter,
} from '../src/android-navigation';

test('AND-20 Unpaid seat is released for booking again', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-20', 'primary');
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  const showtimeLabels = (await showtimes[0].$$('android.widget.TextView')
    .map(async (label) => (await label.getText()).trim())).filter(Boolean);
  const showtimeLabel = showtimeLabels.find((label) => /\d{1,2}:\d{2}/.test(label));
  expect(showtimeLabel, 'The selected showtime exposes a readable start time').toBeDefined();
  if (!showtimeLabel) throw new Error('The selected showtime exposed no readable start time.');
  const showtimeTime = /\d{1,2}:\d{2}/.exec(showtimeLabel)?.[0] ?? showtimeLabel;
  await tapElementCenter(app, showtimes[0]);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Selecting a showtime did not open seat categories',
  });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const categoryLoading = app.$('id=com.cinescape:id/progress');
  await categoryLoading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Proceeding with General did not load the seat map',
  });
  await categoryLoading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'The seat map did not finish loading',
  });

  const seatTable = app.$('id=com.cinescape:id/seat_table');
  const seats = await seatTable.$$('android.widget.TextView');
  let selectedSeat: WebdriverIO.Element | undefined;
  let seatNumber = '';
  for (const seat of seats) {
    seatNumber = (await seat.getText()).trim();
    if (/^\d+$/.test(seatNumber) && await seat.isEnabled()) {
      selectedSeat = seat;
      break;
    }
  }
  expect(selectedSeat, 'An available seat can be held without payment').toBeDefined();
  if (!selectedSeat) throw new Error('No available seat was present for the hold-expiry test.');
  await tapNativeElementCenter(app, selectedSeat);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  const checkoutLoading = app.$('id=com.cinescape:id/progress');
  await checkoutLoading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Proceeding with the selected seat did not open checkout',
  });
  await checkoutLoading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'The unpaid booking did not finish loading checkout',
  });

  const checkoutLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .filter(Boolean);
  expect(checkoutLabels).toContain(title);
  expect((await app.$('id=com.cinescape:id/seatNumber').getText()).trim()).toContain(seatNumber);
  expect(checkoutLabels).toContain('Amount to be paid');
  await snap(`AND-20: unpaid seat held at checkout (${dateLabel}, ${showtimeLabel})`);

  await app.$('id=com.cinescape:id/text_cancel').click();
  const cancelConfirmation = app.$('id=com.cinescape:id/txtSureNew');
  await cancelConfirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Canceling unpaid checkout did not request confirmation',
  });
  await cancelConfirmation.click();
  await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Canceling unpaid checkout did not return to movie details',
  });

  const dateChips = await app.$$('id=com.cinescape:id/card_day_date');
  const currentDateLabels = await dateChips.map(async (chip) => (
    await chip.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));
  const dateIndex = currentDateLabels.findIndex((label) => label === dateLabel);
  expect(dateIndex, `The held show's date "${dateLabel}" remains available`).toBeGreaterThanOrEqual(0);
  const currentDateChips = await app.$$('id=com.cinescape:id/card_day_date');
  await tapElementCenter(app, currentDateChips[dateIndex]);
  await app.pause(1_000);
  const sameShowtimes = await app.$$('id=com.cinescape:id/card_scroll');
  expect(await sameShowtimes.length, 'The held showtime is available for a retry').toBeGreaterThan(0);
  let matchingShowtime: WebdriverIO.Element | undefined;
  for (const item of sameShowtimes) {
    const itemLabels = (await item.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
      .filter(Boolean);
    if (itemLabels.some((label) => label.includes(showtimeTime))) {
      matchingShowtime = item;
      break;
    }
  }
  expect(matchingShowtime, `The original showtime "${showtimeLabel}" is still listed`).toBeDefined();
  if (!matchingShowtime) throw new Error('The original showtime could not be reopened.');
  await tapNativeElementCenter(app, matchingShowtime);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Reopening the showtime did not open seat categories',
  });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  await categoryLoading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Retrying the show did not start loading its seat map',
  });
  await categoryLoading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'Retry seat map did not finish loading',
  });
  const retrySeats = await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView');
  let releasedSeatAvailable = false;
  for (const seat of retrySeats) {
    if ((await seat.getText()).trim() === seatNumber && await seat.isEnabled()) {
      releasedSeatAvailable = true;
      break;
    }
  }
  expect(releasedSeatAvailable, `Seat ${seatNumber} can be selected again after cancellation`).toBe(true);
  await snap(`AND-20: seat ${seatNumber} is available again`);
});
