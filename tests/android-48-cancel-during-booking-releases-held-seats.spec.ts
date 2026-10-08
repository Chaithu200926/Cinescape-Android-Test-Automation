import { expect, test } from '../src/fixtures';
import {
  beginCaseJourney,
  openSingleSeatCheckout,
  tapElementCenter,
  tapNativeElementCenter,
} from '../src/android-navigation';

test('AND-48 Cancel during booking releases held seats', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-48', 'kiosk');
  const { title, dateLabel, showtimeLabel, seatRow, seatNumber } = await openSingleSeatCheckout(app, snap, 'AND-48');
  expect(seatRow, 'The held seat has a readable row label').toMatch(/^[A-Z]$/);
  if (!/^[A-Z]$/.test(seatRow)) throw new Error(`The selected seat exposed no readable row: "${seatRow}".`);
  const showtimeTime = /\d{1,2}:\d{2}/.exec(showtimeLabel)?.[0];
  expect(showtimeTime, 'The selected showtime exposes a readable start time').toBeDefined();
  if (!showtimeTime) throw new Error(`The selected showtime exposed no readable time: ${showtimeLabel}`);

  const cancelButton = app.$('id=com.cinescape:id/text_cancel');
  await cancelButton.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Checkout did not offer a cancel action',
  });
  await cancelButton.click();
  const cancelConfirmation = app.$('id=com.cinescape:id/txtSureNew');
  await cancelConfirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Canceling checkout did not request confirmation',
  });
  await cancelConfirmation.click();
  await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Canceling checkout did not return to movie details',
  });
  await snap(`AND-48: canceled checkout holding seat ${seatRow}${seatNumber}`);

  const dateChips = await app.$$('id=com.cinescape:id/card_day_date');
  const dateLabels = await dateChips.map(async (chip) => (
    await chip.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));
  const dateIndex = dateLabels.findIndex((label) => label === dateLabel);
  expect(dateIndex, `The selected date "${dateLabel}" remains available`).toBeGreaterThanOrEqual(0);
  if (dateIndex < 0) throw new Error(`The selected date "${dateLabel}" could not be reopened.`);
  await tapElementCenter(app, (await app.$$('id=com.cinescape:id/card_day_date'))[dateIndex]);
  await app.pause(1_000);

  const showtimes = await app.$$('id=com.cinescape:id/card_scroll');
  let matchingShowtime: WebdriverIO.Element | undefined;
  for (const showtime of showtimes) {
    const labels = (await showtime.$$('android.widget.TextView')
      .map(async (label) => (await label.getText()).trim())).filter(Boolean);
    if (labels.some((label) => label.includes(showtimeTime))) {
      matchingShowtime = showtime;
      break;
    }
  }
  expect(matchingShowtime, `The original showtime "${showtimeLabel}" is still listed`).toBeDefined();
  if (!matchingShowtime) throw new Error(`The original showtime "${showtimeLabel}" could not be reopened.`);
  await tapNativeElementCenter(app, matchingShowtime);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Reopening the original showtime did not open seat categories',
  });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();

  const loading = app.$('id=com.cinescape:id/progress');
  await loading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Selecting General did not start loading the seat map',
  });
  await loading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'The seat map did not finish loading after cancellation',
  });

  const seats = await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView');
  let releasedSeatAvailable = false;
  let currentRow = '';
  for (const seat of seats) {
    const label = (await seat.getText()).trim();
    if (/^[A-Z]$/.test(label)) {
      currentRow = label;
    } else if (currentRow === seatRow && label === seatNumber && await seat.isEnabled()) {
      releasedSeatAvailable = true;
      break;
    }
  }
  expect(releasedSeatAvailable, `Seat ${seatRow}${seatNumber} for ${title} can be selected again after cancellation`).toBe(true);
  await snap(`AND-48: canceled booking released seat ${seatRow}${seatNumber}`);
});
