import { expect, test } from '../src/fixtures';
import {
  beginCaseJourney,
  checkoutScreen,
  openFirstMovieDetails,
  seatMapScreen,
  selectFutureDateWithShowtimes,
  tapElementCenter,
  tapNativeElementCenter,
  waitForLoadingStep,
} from '../src/android-navigation';

test('AND-18 Seat category, seat type and ticket quantity', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-18', 'kiosk');
  const { title } = await openFirstMovieDetails(app);
  await snap(`AND-18: showtimes for ${title}`);

  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  expect(showtimes.length, `The selected future date "${dateLabel}" has an available showtime`).toBeGreaterThan(0);
  await tapElementCenter(app, showtimes[0]);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Selecting a showtime did not open the seat-category chooser',
  });
  await snap(`AND-18: ${dateLabel} showtime selected`);

  const source = await app.getPageSource();
  const bookingLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())).filter(Boolean);
  expect(bookingLabels, 'The screen offers named seat categories').toEqual(expect.arrayContaining(['Family', 'General']));
  expect(await app.$('id=com.cinescape:id/text_proceeds').isDisplayed(), 'The seat-category screen offers a continue action').toBe(true);
  expect(source, 'Selecting a showtime leaves the movie details screen').not.toContain('resource-id="com.cinescape:id/screenShowTime"');

  const generalCategory = app.$('android=new UiSelector().text("General")');
  expect(await generalCategory.isDisplayed(), 'General seat category is selectable').toBe(true);
  await generalCategory.click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const loadingIndicator = app.$('id=com.cinescape:id/progress');
  await waitForLoadingStep(app, seatMapScreen, 'Proceeding with General did not start loading the seat-selection screen', 'The seat-selection screen did not finish loading after choosing General');
  await snap('AND-18: General seat category selected');

  const seatSelectionSource = await app.getPageSource();
  const seatSelectionLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())).filter(Boolean);
  expect(seatSelectionLabels).toEqual(expect.arrayContaining([
    title,
    'Cinescape 360',
    // The screen type differs by environment (AWS: STANDARD INFINITY VISION, Internal: INFINITY).
    expect.stringMatching(/^General\s*\|\s*\S/),
    'Available',
    'Unavailable',
    'Selected',
  ]));
  const seatTable = app.$('id=com.cinescape:id/seat_table');
  expect(await seatTable.isDisplayed(), 'The seat layout is displayed').toBe(true);
  const seatTableSize = await seatTable.getSize();
  expect(seatTableSize.width, 'The seat layout has a visible screen width').toBeGreaterThan(0);
  expect(seatTableSize.height, 'The seat layout has a visible screen height').toBeGreaterThan(0);

  const seatCells = await seatTable.$$('android.widget.TextView');
  const candidateSeats = [];
  for (const cell of seatCells) {
    const label = (await cell.getText()).trim();
    if (/^\d+$/.test(label) && await cell.isEnabled()) candidateSeats.push({ cell, label });
  }
  expect(candidateSeats.length, 'The seat map exposes selectable numbered seats').toBeGreaterThan(0);
  const selectedSeat = candidateSeats[0];
  await tapNativeElementCenter(app, selectedSeat.cell);
  expect(seatSelectionSource, 'Proceeding with General advances beyond category selection').not.toContain('resource-id="com.cinescape:id/select_seat_category"');

  await app.$('id=com.cinescape:id/txt_proceed').click();
  const checkoutLoading = app.$('id=com.cinescape:id/progress');
  await waitForLoadingStep(app, checkoutScreen, 'Continuing with the selected seat did not start checkout', 'Checkout did not finish loading after a seat was selected');
  const checkoutLabels = (await app.$$('android.widget.TextView')
    .map(async (label) => (await label.getText()).trim())).filter(Boolean);
  const ticketPriceText = (await app.$('id=com.cinescape:id/text_kds').getText()).trim();
  const ticketQuantity = Number((await app.$('id=com.cinescape:id/text_qty_number').getText()).trim());
  const ticketTotalText = (await app.$('id=com.cinescape:id/text_kd_total').getText()).trim();
  const ticketPrice = Number(/(\d+(?:\.\d{1,3})?)/.exec(ticketPriceText)?.[1]);
  const ticketTotal = Number(/(\d+(?:\.\d{1,3})?)/.exec(ticketTotalText)?.[1]);
  expect(checkoutLabels).toContain(title);
  expect((await app.$('id=com.cinescape:id/seatNumber').getText()).trim()).toContain(selectedSeat.label);
  expect(ticketQuantity, 'One selected seat produces one ticket at checkout').toBe(1);
  expect(ticketPrice, `Checkout shows a readable ticket price: ${ticketPriceText}`).toBeGreaterThan(0);
  expect(ticketTotal, `Checkout shows a readable ticket total: ${ticketTotalText}`).toBeCloseTo(ticketPrice, 3);
  expect(checkoutLabels).toContain('Amount to be paid');
  await snap(`AND-18: one-ticket price and total verified for ${title}`);

  await app.$('id=com.cinescape:id/text_cancel').click();
  const cancelConfirmation = app.$('id=com.cinescape:id/txtSureNew');
  await cancelConfirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Leaving the unpaid checkout did not request cancellation confirmation',
  });
  await cancelConfirmation.click();
});
