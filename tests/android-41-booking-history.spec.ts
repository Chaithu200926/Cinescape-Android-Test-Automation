import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  bookingHistory,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  payWithKnet,
  payWithWallet,
  readKwd,
  registerFreshTestAccount,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
const text = async (app: AndroidApp, name: string) => (await app.$(id(name)).getText().catch(() => '')).trim();

/** Expands the newest History entry and reads its booking and payment details. */
const readNewestHistoryEntry = async (app: AndroidApp) => {
  await app.$(id('view_booking_history')).click();
  await app.$(id('textView_seat_name')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The newest History entry did not expand' });
  const booking = {
    location: await text(app, 'text_address'),
    screen: await text(app, 'textView_screen_number'),
    date: await text(app, 'textView_date_info'),
    time: await text(app, 'textView_time_info'),
    experience: await text(app, 'textView_experience_name'),
    category: await text(app, 'textView_category_name'),
    seats: await app.$$(id('textView_seat_name')).map(async (seat) => (await seat.getText()).trim()),
  };
  // The payment details sit below the fold of the expanded entry.
  const historyList = 'new UiScrollable(new UiSelector().resourceId("com.cinescape:id/recyclerview_booking_history"))';
  await app.$(`android=${historyList}.scrollIntoView(new UiSelector().resourceId("com.cinescape:id/textViewTotal"))`).waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'The expanded History entry did not show a Grand Total',
  });
  const payment = {
    bookingId: await text(app, 'tvBookingIdNumber'),
    trackId: await text(app, 'tvTrackIdNumber'),
    transactionId: await text(app, 'tvReferenceIdInfo'),
    transactionDateTime: await text(app, 'tvReferenceIdInfoa'),
    modes: await app.$$(id('textPaymentNames')).map(async (mode) => (await mode.getText()).trim()),
    modeAmounts: await app.$$(id('textPrices')).map(async (amount) => readKwd(await amount.getText(), 'Payment mode amount')),
    grandTotal: readKwd(await text(app, 'textViewTotal'), 'History Grand Total'),
  };
  return { ...booking, ...payment };
};

test('AND-41 Booking history', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  // ANDROID_HISTORY_FRESH_ACCOUNT=1 runs the case with a newly registered customer (empty History, empty wallet), who
  // pays with the KNET test card; otherwise the Kiosk UAT customer pays from the wallet.
  const freshAccount = process.env.ANDROID_HISTORY_FRESH_ACCOUNT === '1';
  if (!freshAccount && !hasKioskCustomer(androidConfig)) {
    throw new Error('AND-41 needs the configured Kiosk UAT customer, whose wallet pays for the booking that is then cancelled.');
  }

  // A booking made and cancelled in this run gives History an entry whose details are known.
  if (freshAccount) {
    await registerFreshTestAccount(app, androidConfig);
    await snap(`AND-41: new customer ${androidConfig.newUser.email} signed in`);
  } else {
    await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-41', 'kiosk');
  }
  const { title, total, review } = await openPaymentMethods(app, snap, 'AND-41');
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = freshAccount ? await payWithKnet(app, androidConfig, snap, 'AND-41') : await payWithWallet(app);
    await snap(`AND-41: ${title} booked as ${bookingId} for KWD ${total.toFixed(3)}`);
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }

  // 1–2. History lists every entry with a title and status; the newest is the cancelled booking.
  const entries = await bookingHistory(app);
  expect(entries.length, 'History lists at least the booking just cancelled').toBeGreaterThan(0);
  for (const entry of entries) expect(entry.title, 'Every History entry names its movie or wallet action').not.toBe('');
  const newest = entries[0];
  expect(newest.title, 'The newest History entry is the movie just booked').toBe(review.movie);
  expect(newest.status, 'The cancelled booking is marked Cancelled').toBe('Cancelled');
  // Wallet recharges and food-only orders are listed too, but carry no booking status.
  const movieEntries = entries.filter((entry) => !['Wallet Recharge', 'Food Order'].includes(entry.title));
  const foodOrders = entries.filter((entry) => entry.title === 'Food Order');
  if (foodOrders.some((entry) => !entry.status)) {
    test.info().annotations.push({ type: 'finding', description: 'Food Order entries in History show no status (e.g. paid / prepared / collected).' });
  }
  for (const entry of movieEntries.filter((item) => item !== newest)) {
    expect(entry.status, `"${entry.title}" (${entry.date}) shows a booking status`).not.toBe('');
  }
  await snap(`AND-41: History lists ${entries.length} entries, newest ${newest.title} — ${newest.status}`);

  // 3. The expanded entry matches what was booked and paid.
  const details = await readNewestHistoryEntry(app);
  await snap(`AND-41: History details for ${details.bookingId}`);
  expect(details.bookingId, 'History shows the Booking ID from the ticket').toBe(bookingId);
  expect(details.location).toBe(review.location);
  expect(details.screen).toBe(review.screen);
  expect(details.date).toBe(review.date);
  expect(details.time).toBe(review.time);
  expect(details.category).toBe('General');
  expect(details.experience, 'History names the experience').not.toBe('');
  expect(details.seats).toEqual(review.seats);
  expect(details.trackId, 'History shows a Track ID').toMatch(/^\d+$/);
  expect(details.transactionId, 'History shows a Transaction ID').toMatch(/^[1-9]\d*$/);
  expect(details.transactionDateTime, 'History shows when the payment was made').toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  if (freshAccount) {
    expect(details.modes.join(' '), 'History names KNET as the payment mode').toMatch(/knet/i);
    expect(entries.length, 'A new customer has no History beyond this booking').toBeLessThanOrEqual(2);
  } else {
    expect(details.modes).toEqual(['Wallet']);
  }
  expect(details.modeAmounts[0]).toBeCloseTo(total, 3);
  expect(details.grandTotal, 'History Grand Total equals the amount paid').toBeCloseTo(total, 3);
  test.info().annotations.push({
    type: 'history entry',
    description: `List date "${newest.date}" | transaction ${details.transactionDateTime} | ${details.date} ${details.time} seat ${details.seats.join(', ')}`,
  });
  await snap(`AND-41: ${bookingId} — ${details.modes.join(', ')} KWD ${details.grandTotal.toFixed(3)}, cancelled`);
});
