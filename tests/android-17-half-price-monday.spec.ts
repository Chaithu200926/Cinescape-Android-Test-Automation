import { expect, test } from '../src/fixtures';
import {
  beginCaseJourney,
  openFirstMovieDetails,
  tapElementCenter,
  tapNativeElementCenter,
} from '../src/android-navigation';

test('AND-17 Half-price Monday', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-17', 'primary');
  const { title } = await openFirstMovieDetails(app);
  await snap(`AND-17: showtimes for ${title}`);

  const dates = await app.$$('id=com.cinescape:id/card_day_date');
  const dateLabels = await dates.map(async (date) => (
    await date.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));
  const mondayIndex = dateLabels.findIndex((label) => /mon(?:day)?/i.test(label));
  expect(mondayIndex, `The app lists a Monday show date: ${dateLabels.join(' | ')}`).toBeGreaterThanOrEqual(0);

  const currentMondayCards = await app.$$('id=com.cinescape:id/card_day_date');
  const mondayLabel = dateLabels[mondayIndex];
  const mondayDate = (await currentMondayCards[mondayIndex].$$('android.widget.TextView'))[1];
  await tapElementCenter(app, mondayDate);
  await app.pause(1_000);
  const mondayShowtimes = await app.$$('id=com.cinescape:id/card_scroll');
  expect(await mondayShowtimes.length, `Monday "${mondayLabel}" has a bookable showtime`).toBeGreaterThan(0);
  const mondayShowtimeLabels = await mondayShowtimes[0].$$('android.widget.TextView')
    .map(async (label) => (await label.getText()).trim());
  await snap(`AND-17: Monday ${mondayLabel} showtimes`);

  await tapElementCenter(app, mondayShowtimes[0]);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Selecting the Monday showtime did not open seat categories',
  });
  const categoryLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .filter(Boolean);
  expect(categoryLabels).toEqual(expect.arrayContaining(['General']));
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();

  const loadingIndicator = app.$('id=com.cinescape:id/progress');
  await loadingIndicator.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Proceeding with General did not load Monday seat selection',
  });
  await loadingIndicator.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'Monday seat selection did not finish loading',
  });

  const seatLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .filter(Boolean);
  expect(seatLabels).toContain('General  |  STANDARD INFINITY VISION');
  await snap(`AND-17: General/Standard on Monday ${mondayLabel}`);

  const seatTypes = app.$('id=com.cinescape:id/text_seat_types');
  await seatTypes.click();
  const confirmation = app.$('id=com.cinescape:id/txtSureNew');
  await confirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Changing seat type did not ask to reset the current selection',
  });
  await confirmation.click();
  await app.pause(1_000);
  const typeLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .filter(Boolean);
  expect(typeLabels).toContain('General  |  STANDARD INFINITY VISION');
  expect(typeLabels.some((label) => /standard/i.test(label)), 'Standard seat type is offered for Monday')
    .toBe(true);

  const seatTable = app.$('id=com.cinescape:id/seat_table');
  const seats = await seatTable.$$('android.widget.TextView');
  let availableSeat: WebdriverIO.Element | undefined;
  for (const seat of seats) {
    if (/^\d+$/.test((await seat.getText()).trim()) && await seat.isEnabled()) {
      availableSeat = seat;
      break;
    }
  }
  expect(availableSeat, 'A seat is available for the Monday price check').toBeDefined();
  if (!availableSeat) throw new Error('The Monday seat map exposed no available seat.');
  await tapNativeElementCenter(app, availableSeat);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  const checkoutProgress = app.$('id=com.cinescape:id/progress');
  await checkoutProgress.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Continuing with the Monday seat did not start loading the next booking step',
  });
  await checkoutProgress.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'The Monday booking did not finish loading its next step',
  });
  const paymentSource = await app.getPageSource();
  const paymentLabels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .filter(Boolean);
  await snap(`AND-17: Monday checkout for ${title}`);
  expect(paymentSource, 'Proceeding with a selected Monday seat advances beyond the seat map')
    .not.toContain('resource-id="com.cinescape:id/seat_table"');
  const mondayDay = /\d{1,2}/.exec(mondayLabel)?.[0];
  expect(mondayDay, `Selected date is identified as Monday: ${mondayLabel}`).toBeDefined();
  expect(paymentLabels.some((label) => label.startsWith(`${mondayDay} `)), 'Checkout retains the selected Monday date')
    .toBe(true);
  const mondayPriceText = (await app.$('id=com.cinescape:id/text_kds').getText()).trim();
  const mondayQuantity = Number((await app.$('id=com.cinescape:id/text_qty_number').getText()).trim());
  const mondayTotalText = (await app.$('id=com.cinescape:id/text_kd_total').getText()).trim();
  const mondayPrice = Number(/(\d+(?:\.\d{1,3})?)/.exec(mondayPriceText)?.[1]);
  const mondayTotal = Number(/(\d+(?:\.\d{1,3})?)/.exec(mondayTotalText)?.[1]);
  expect(mondayPrice, `Monday ticket price is readable from checkout: ${mondayPriceText}`).toBeGreaterThan(0);
  expect(mondayQuantity, 'The Monday checkout quantity is one').toBe(1);
  expect(mondayTotal, 'The Monday total matches one ticket').toBeCloseTo(mondayPrice * mondayQuantity, 3);

  await app.$('id=com.cinescape:id/text_cancel').click();
  const cancelConfirmation = app.$('id=com.cinescape:id/txtSureNew');
  await cancelConfirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Leaving the Monday checkout did not request booking cancellation',
  });
  await cancelConfirmation.click();
  await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Canceling the unpaid Monday booking did not return to movie details',
  });

  const comparisonDates = await app.$$('id=com.cinescape:id/card_day_date');
  const comparisonLabels = await comparisonDates.map(async (date) => (
    await date.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));
  const weekdayIndex = comparisonLabels.findIndex((label) => !/mon(?:day)?/i.test(label));
  expect(weekdayIndex, 'The app offers another weekday for comparison').toBeGreaterThanOrEqual(0);
  expect(weekdayIndex, `Comparison date is selectable: ${comparisonLabels.join(' | ')}`).toBeLessThan(await comparisonDates.length);
  const weekdayLabel = comparisonLabels[weekdayIndex];
  await tapElementCenter(app, comparisonDates[weekdayIndex]);
  await app.pause(1_000);
  const weekdayShowtimes = await app.$$('id=com.cinescape:id/card_scroll');
  expect(await weekdayShowtimes.length, `The comparison date "${weekdayLabel}" has a showtime`).toBeGreaterThan(0);
  await tapElementCenter(app, weekdayShowtimes[0]);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Selecting a weekday showtime did not open seat categories',
  });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const weekdayLoading = app.$('id=com.cinescape:id/progress');
  await weekdayLoading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Proceeding with General did not start loading weekday seats',
  });
  await weekdayLoading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'Weekday seat selection did not finish loading',
  });
  expect((await app.$('id=com.cinescape:id/tv_seat_timing_date').getText()).toLowerCase())
    .toContain(weekdayLabel.split(/\s+/)[0].toLowerCase());

  const weekdaySeatTable = app.$('id=com.cinescape:id/seat_table');
  const weekdaySeats = await weekdaySeatTable.$$('android.widget.TextView');
  let weekdaySeat: WebdriverIO.Element | undefined;
  for (const seat of weekdaySeats) {
    if (/^\d+$/.test((await seat.getText()).trim()) && await seat.isEnabled()) {
      weekdaySeat = seat;
      break;
    }
  }
  expect(weekdaySeat, 'A seat of the same General/Standard type is available on the comparison day').toBeDefined();
  if (!weekdaySeat) throw new Error('The weekday seat map exposed no available seat.');
  await tapNativeElementCenter(app, weekdaySeat);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  const weekdayCheckoutLoading = app.$('id=com.cinescape:id/progress');
  await weekdayCheckoutLoading.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Continuing with the weekday seat did not load checkout',
  });
  await weekdayCheckoutLoading.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'Weekday checkout did not finish loading',
  });
  const weekdayPriceText = (await app.$('id=com.cinescape:id/text_kds').getText()).trim();
  const weekdayPrice = Number(/(\d+(?:\.\d{1,3})?)/.exec(weekdayPriceText)?.[1]);
  const weekdayTotalText = (await app.$('id=com.cinescape:id/text_kd_total').getText()).trim();
  const weekdayQuantity = Number((await app.$('id=com.cinescape:id/text_qty_number').getText()).trim());
  const weekdayTotal = Number(/(\d+(?:\.\d{1,3})?)/.exec(weekdayTotalText)?.[1]);
  expect(weekdayPrice, `Comparison-day ticket price is readable: ${weekdayPriceText}`).toBeGreaterThan(0);
  expect(weekdayQuantity, 'The comparison checkout quantity is one').toBe(1);
  expect(weekdayTotal, 'The comparison total matches one ticket').toBeCloseTo(weekdayPrice, 3);
  await snap(`AND-17: weekday ${weekdayLabel} checkout`);
  expect(mondayPrice, 'Monday ticket price is exactly half the comparable weekday price')
    .toBeCloseTo(weekdayPrice * 0.5, 3);

  await app.$('id=com.cinescape:id/text_cancel').click();
  const weekdayCancelConfirmation = app.$('id=com.cinescape:id/txtSureNew');
  await weekdayCancelConfirmation.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Leaving the weekday checkout did not request cancellation',
  });
  await weekdayCancelConfirmation.click();
  await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Canceling the unpaid weekday booking did not return to movie details',
  });
});
