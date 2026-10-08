import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  hasKioskCustomer,
  openArea,
  openSingleSeatCheckout,
} from '../src/android-navigation';

const readKwd = (text: string, label: string) => {
  const match = /(?:KWD|KD)?\s*([\d,]+(?:\.\d{1,3})?)/i.exec(text);
  if (!match) throw new Error(`${label} did not contain a readable KWD amount: ${text}`);
  return Number(match[1].replace(/,/g, ''));
};

const bookingIdsOnScreen = async (app: import('../src/android-navigation').AndroidApp) => {
  const grid = app.$('id=com.cinescape:id/recyclerview_booking');
  if (!(await grid.isDisplayed().catch(() => false))) return [];
  const cards = app.$('id=com.cinescape:id/recyclerview_booking').$$('id=com.cinescape:id/imageView7');
  const cardCount = await cards.length;
  const values: string[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    const currentCards = app.$('id=com.cinescape:id/recyclerview_booking').$$('id=com.cinescape:id/imageView7');
    await currentCards[index].click();
    await app.$('id=com.cinescape:id/uiFinalTaket').waitForDisplayed({
      timeout: 20_000,
      timeoutMsg: 'Opening an upcoming booking card did not show its ticket details',
    });
    const bookingId = (await app.$('id=com.cinescape:id/text_bookin_id_no').getText()).trim();
    if (/^[A-Z0-9]{5,}$/i.test(bookingId)) values.push(bookingId);
    await app.back();
    await app.$('id=com.cinescape:id/recyclerview_booking').waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: 'Back from ticket details did not return to the Upcoming Bookings list',
    });
  }
  return [...new Set(values)];
};

test('AND-50 Reopen booking confirmation without duplicate booking', async ({ app, snap, androidConfig }) => {
  test.setTimeout(360_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-50 needs the configured Kiosk UAT customer (username, password and OTP) to make a refundable test-wallet booking.');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-50', 'kiosk');
  await openArea(app, 'account');
  const balanceElement = app.$('id=com.cinescape:id/text_user_wallet_kd');
  await balanceElement.waitForDisplayed({ timeout: 20_000, timeoutMsg: 'The Kiosk test account did not show its wallet balance' });
  const balanceBefore = readKwd(await balanceElement.getText(), 'Wallet balance before booking');

  const upcomingEntry = app.$('id=com.cinescape:id/view_booking');
  await upcomingEntry.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The Account screen did not show Upcoming Bookings' });
  await app.$('id=com.cinescape:id/text_upcoming_booking').waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'The Account screen did not render its Upcoming Bookings section',
  });
  const bookingIdsBefore = await bookingIdsOnScreen(app);
  await snap(`AND-50: baseline upcoming booking IDs (${bookingIdsBefore.length})`);

  let bookingId: string;
  let total: number | undefined;
  let bookingCreatedInThisRun = false;
  if (bookingIdsBefore.length > 0) {
    // Reuse the test customer's existing confirmed booking on reruns, so the test never pays twice.
    bookingId = bookingIdsBefore[0];
    await snap(`AND-50: reusing existing confirmed booking ${bookingId}`);
  } else {
    await openArea(app, 'movies');
    const { title, paymentList } = await openSingleSeatCheckout(app, snap, 'AND-50');
    const totalElement = app.$('id=com.cinescape:id/text_kd_total');
    await totalElement.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Checkout did not show the booking total' });
    const totalText = (await totalElement.getText()).trim();
    total = readKwd(totalText, 'Booking total');
    expect(total, `The one-seat booking for ${title} should have a positive total`).toBeGreaterThan(0);
    expect(balanceBefore, 'The configured Kiosk wallet should cover this one-seat test booking').toBeGreaterThanOrEqual(total);

    if (!(await paymentList.isDisplayed().catch(() => false))) {
      const proceed = app.$('id=com.cinescape:id/txt_proceed');
      await proceed.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Checkout review did not offer Proceed to payment methods' });
      await proceed.click();
      await paymentList.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Proceed did not open the payment-method list' });
    }

    const walletChoice = app.$('android=new UiSelector().textContains("Use your Wallet")');
    await walletChoice.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Payment methods did not offer wallet payment' });
    await walletChoice.click();
    const applyWallet = app.$('id=com.cinescape:id/textview_bt_wallet_apply');
    await applyWallet.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Wallet details did not show Apply' });
    await applyWallet.click();

    const confirmationId = app.$('id=com.cinescape:id/text_bookin_id_no');
    await confirmationId.waitForDisplayed({ timeout: 90_000, timeoutMsg: 'Wallet payment did not open the confirmed ticket screen' });
    bookingId = (await confirmationId.getText()).trim();
    expect(bookingId, 'A confirmed booking should show a valid Booking ID').toMatch(/^[A-Z0-9]{5,}$/i);
    bookingCreatedInThisRun = true;
    await snap(`AND-50: booking ${bookingId} confirmed for ${totalText}`);
  }
  expect(bookingId, 'The selected confirmed booking should have a valid ID').toMatch(/^[A-Z0-9]{5,}$/i);

  await app.background(2);
  await app.activateApp(androidConfig.appPackage);
  await openArea(app, 'account');
  await upcomingEntry.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Reopened Account did not show Upcoming Bookings' });
  await app.$('id=com.cinescape:id/text_upcoming_booking').waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'Upcoming Bookings did not reopen after backgrounding the app',
  });

  const idsAfterReopen = await bookingIdsOnScreen(app);
  expect(idsAfterReopen, 'The confirmed booking should appear in Upcoming Bookings').toContain(bookingId);
  expect([...idsAfterReopen].sort(), 'Reopening should preserve the exact same set of Booking IDs').toEqual(
    (bookingCreatedInThisRun ? [...bookingIdsBefore, bookingId] : bookingIdsBefore).sort(),
  );
  const walletAfterReopen = readKwd(await balanceElement.getText(), 'Wallet balance after reopening');
  await snap(`AND-50: reopened upcoming list contains ${bookingId} once`);

  await app.$('id=com.cinescape:id/recyclerview_booking').$('id=com.cinescape:id/imageView7').click();
  const detailsScreen = app.$('id=com.cinescape:id/uiFinalTaket');
  await detailsScreen.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Selecting the booking did not open its ticket details' });
  const detailsId = app.$('id=com.cinescape:id/text_bookin_id_no');
  await detailsId.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Ticket details did not show a Booking ID' });
  expect((await detailsId.getText()).trim()).toBe(bookingId);
  const detailsSource = await app.getPageSource();
  expect(detailsSource, 'Reopened ticket details should include a QR code').toContain('com.cinescape:id/image_qr_code');
  await snap(`AND-50: booking details reopened for ${bookingId}`);

  await app.back();
  await app.$('id=com.cinescape:id/text_upcoming_booking').waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Back did not return to Upcoming Bookings' });
  const idsAfterBack = await bookingIdsOnScreen(app);
  expect(idsAfterBack, 'Revisiting details must not add another booking').toEqual(idsAfterReopen);
  const walletAfterBack = readKwd(await balanceElement.getText(), 'Wallet balance after returning from ticket details');
  if (total !== undefined) {
    expect(balanceBefore - walletAfterReopen, 'The wallet should have been charged once for the confirmed amount')
      .toBeCloseTo(total, 3);
  } else {
    expect(walletAfterReopen, 'Reopening an existing booking must leave its wallet balance unchanged')
      .toBeCloseTo(balanceBefore, 3);
  }
  expect(walletAfterBack, 'Returning from ticket details must not create another charge')
    .toBeCloseTo(walletAfterReopen, 3);
  await snap(`AND-50: same booking ID and no extra wallet charge after Back`);
});
