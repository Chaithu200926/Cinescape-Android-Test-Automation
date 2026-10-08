import { test, expect } from '../src/fixtures';
import {
  amountToBePaid,
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openKnetGateway,
  payWithWallet,
  readKwd,
  readWalletBalance,
  selectOneSeat,
  tapNativeElementCenter,
} from '../src/android-navigation';

test('AND-25 Cart and price check', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-25 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-25', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');

  // 1. Choose tickets: one seat, then try a second one.
  const { title, seatRow, seatNumber, progress } = await selectOneSeat(app, snap, 'AND-25');
  const firstSeat = `${seatRow}${seatNumber}`;
  let currentRow = '';
  let secondSeat: { cell: WebdriverIO.Element; label: string } | undefined;
  for (const cell of await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView')) {
    const label = (await cell.getText()).trim();
    if (/^[A-Z]$/.test(label)) currentRow = label;
    else if (/^\d+$/.test(label) && `${currentRow}${label}` !== firstSeat && await cell.isEnabled()) {
      secondSeat = { cell, label: `${currentRow}${label}` };
      break;
    }
  }
  if (!secondSeat) throw new Error('The seat map has no second available seat.');
  await tapNativeElementCenter(app, secondSeat.cell);
  const limit = app.$('id=com.cinescape:id/subtitle');
  const limited = await limit.waitForDisplayed({ timeout: 5_000 }).then(() => true, () => false);
  let expectedSeats = [firstSeat, secondSeat.label];
  if (limited) {
    // The current UAT build allows one seat per booking, unlike the workbook's two-ticket step.
    const message = (await limit.getText()).trim();
    expect(message, 'The app explains the one-seat limit').toMatch(/more than 1/i);
    test.info().annotations.push({ type: 'deviation', description: `UAT refuses a second seat: "${message}". The cart is checked with one ticket.` });
    await snap(`AND-25: second seat refused - "${message}"`);
    await app.$('id=com.cinescape:id/positive_btn').click();
    expectedSeats = [firstSeat];
  } else {
    await snap(`AND-25: seats ${firstSeat} and ${secondSeat.label} selected`);
  }

  // 2. The summary shows ticket price x quantity = total, for exactly the chosen seats.
  await app.$('id=com.cinescape:id/txt_proceed').click();
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
  await app.$('id=com.cinescape:id/uiCheckout').waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The seats did not open the payment review' });
  const ticketPrice = readKwd(await app.$('id=com.cinescape:id/text_kds').getText(), 'Ticket price');
  const quantity = Number((await app.$('id=com.cinescape:id/text_qty_number').getText()).trim());
  const total = readKwd(await app.$('id=com.cinescape:id/text_kd_total').getText(), 'Total');
  const reviewSeats = await app.$$('id=com.cinescape:id/seatNumber').map(async (seat) => (await seat.getText()).trim());
  expect(reviewSeats.sort(), 'The summary lists exactly the chosen seats').toEqual([...expectedSeats].sort());
  expect(quantity, 'Quantity equals the number of seats').toBe(expectedSeats.length);
  expect(total, `Total = KWD ${ticketPrice.toFixed(3)} x ${quantity}`).toBeCloseTo(ticketPrice * quantity, 3);
  expect(readKwd(await app.$('id=com.cinescape:id/text_time_to_left').getText(), 'Amount to be paid'), 'Amount to be paid equals the total')
    .toBeCloseTo(total, 3);
  await snap(`AND-25: ${title} - KWD ${ticketPrice.toFixed(3)} x ${quantity} = KWD ${total.toFixed(3)}`);

  // The payment page and the KNET gateway ask for the same amount.
  await app.$('id=com.cinescape:id/txt_proceed').click();
  await app.$('id=com.cinescape:id/paymentLayout').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The payment page did not open' });
  expect(await amountToBePaid(app), 'The payment page shows the same total').toBeCloseTo(total, 3);
  expect(await openKnetGateway(app), 'The KNET gateway asks for the same total').toBeCloseTo(total, 3);
  await snap(`AND-25: KNET gateway shows KD ${total.toFixed(3)}`);
  await app.back();
  await app.$('id=com.cinescape:id/paymentLayout').waitForDisplayed({ timeout: 60_000 }).catch(async () => {
    // Leaving the gateway can end the checkout; start the payment step again from the seat map if so.
    throw new Error('Leaving the KNET gateway did not return to the payment page.');
  });

  // 4. After paying, the wallet is charged the same amount.
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    await snap(`AND-25: paid KWD ${total.toFixed(3)} - booking ${bookingId}`);
    await app.back();
    expect(walletBefore - await readWalletBalance(app, 'Wallet balance after payment'), 'The wallet is charged the summary total')
      .toBeCloseTo(total, 3);
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
});
