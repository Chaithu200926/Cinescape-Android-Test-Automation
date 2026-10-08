import { test, expect } from '../src/fixtures';
import {
  acknowledgeAppMessage,
  cancelUnpaidCheckout,
  enterAsGuest,
  hasKioskCustomer,
  openFirstMovieDetails,
  readKwd,
  selectFutureDateWithShowtimes,
  tapElementCenter,
  tapNativeElementCenter,
} from '../src/android-navigation';

test('AND-32 OTP verification', async ({ app, snap, androidConfig }) => {
  test.setTimeout(480_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-32 needs the configured Kiosk UAT customer (username, password and email OTP).');
  }
  const { username, password, otp } = androidConfig.kioskCustomer;

  // Start a booking as a guest: movie, a future date and a showtime. Booking asks for sign-in.
  await enterAsGuest(app);
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  const showtimeTime = (await showtimes[0].$$('android.widget.TextView').map(async (label) => (await label.getText()).trim()))
    .map((label) => /\d{1,2}:\d{2}/.exec(label)?.[0]).find(Boolean);
  if (!showtimeTime) throw new Error(`The first ${dateLabel} showtime has no readable time.`);
  await tapElementCenter(app, showtimes[0]);
  const usernameField = app.$('id=com.cinescape:id/enterUsername');
  await usernameField.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Choosing a showtime as a guest did not ask for sign-in' });
  expect(await app.$('id=com.cinescape:id/txt_continue_guestUi').isDisplayed(), 'The booking sign-in also offers Continue as Guest').toBe(true);
  await snap(`AND-32: guest booking of ${title} ${dateLabel} ${showtimeTime} asks for sign-in`);

  // The email OTP is requested after the password.
  await usernameField.setValue(username);
  await app.$('id=com.cinescape:id/enterpassword').setValue(password);
  await app.$('id=com.cinescape:id/btn_sign_in').click();
  const otpField = app.$('id=com.cinescape:id/textView146');
  await otpField.waitForDisplayed({ timeout: 90_000, timeoutMsg: 'Sign-in did not ask for the email OTP' });
  expect((await app.$('id=com.cinescape:id/textView145').getText()).trim()).toMatch(/OTP sent to your registered email/i);
  const submit = app.$('id=com.cinescape:id/textView150');

  // 1. A wrong OTP is refused with an error and the OTP step stays open.
  await otpField.setValue(otp === '000000' ? '999999' : '000000');
  await app.hideKeyboard().catch(() => undefined);
  await submit.click();
  const wrongOtpMessage = await acknowledgeAppMessage(app, 45_000);
  expect(wrongOtpMessage, 'A wrong OTP is refused').toMatch(/otp.*invalid|invalid.*otp/i);
  expect(await otpField.isDisplayed(), 'The OTP step stays open after a wrong code').toBe(true);
  await snap(`AND-32: wrong OTP refused - "${wrongOtpMessage}"`);

  // 4. The OTP screen offers no resend link; UAT issues a fixed OTP, so expiry cannot be produced here.
  const otpScreenTexts = [...(await app.getPageSource()).matchAll(/text="([^"]+)"/g)].map((match) => match[1]);
  test.info().annotations.push({
    type: 'scope',
    description: `OTP screen texts: ${otpScreenTexts.join(' | ')}. No "resend" option is offered${otpScreenTexts.some((text) => /resend/i.test(text)) ? ' (one was found)' : ''}; expired OTPs cannot be produced on UAT (fixed OTP). Card 3-D Secure OTP is not reachable: UAT refuses the test credit card (see AND-28).`,
  });

  // 2. The correct OTP continues the booking with the earlier choices kept.
  await otpField.clearValue();
  await otpField.setValue(otp);
  await app.hideKeyboard().catch(() => undefined);
  await submit.click();
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 90_000,
    timeoutMsg: 'After the correct OTP the booking did not continue to seat categories',
  });
  await snap('AND-32: correct OTP continues to the seat categories');
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const seatTable = app.$('id=com.cinescape:id/seat_table');
  await seatTable.waitForDisplayed({ timeout: 90_000, timeoutMsg: 'The seat map did not open after sign-in' });
  await app.$('id=com.cinescape:id/progress').waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
  let seat: WebdriverIO.Element | undefined;
  for (const cell of await seatTable.$$('android.widget.TextView')) {
    if (/^\d+$/.test((await cell.getText()).trim()) && await cell.isEnabled()) { seat = cell; break; }
  }
  if (!seat) throw new Error('The seat map has no available seat.');
  await tapNativeElementCenter(app, seat);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  await app.$('id=com.cinescape:id/uiCheckout').waitForDisplayed({ timeout: 90_000, timeoutMsg: 'The seat did not open the payment review' });
  const reviewDate = (await app.$('id=com.cinescape:id/text_date_name').getText()).trim();
  const reviewTime = (await app.$('id=com.cinescape:id/textView19').getText()).trim();
  const reviewMovie = (await app.$('id=com.cinescape:id/summary_name_movie').getText()).trim();
  await snap(`AND-32: review after sign-in - ${reviewMovie} ${reviewDate} ${reviewTime}`);
  const chosenDay = /\d{1,2}/.exec(dateLabel)?.[0];
  expect(reviewMovie.toLowerCase(), 'The movie chosen before sign-in is kept').toContain(title.toLowerCase().trim());
  expect(Number(/\d{1,2}/.exec(reviewDate)?.[0]), `The date chosen before sign-in (${dateLabel}) is kept`).toBe(Number(chosenDay));
  expect(reviewTime, 'The showtime chosen before sign-in is kept').toBe(showtimeTime);
  expect(readKwd(await app.$('id=com.cinescape:id/text_kd_total').getText(), 'Total'), 'The booking has a price').toBeGreaterThan(0);

  // Nothing is paid: leave the checkout.
  await cancelUnpaidCheckout(app);
});
