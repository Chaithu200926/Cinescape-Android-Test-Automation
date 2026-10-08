import { test } from '@playwright/test';
import type { ChainablePromiseElement, remote } from 'webdriverio' with { 'resolution-mode': 'import' };
import sharp from 'sharp';
import type { AndroidConfig } from './android-config';

export type AndroidApp = Awaited<ReturnType<typeof remote>>;

const dismissGenericAppError = async (app: AndroidApp) => {
  const message = app.$('id=com.cinescape:id/subtitle');
  const title = app.$('id=com.cinescape:id/title');
  const messageText = (await message.getText().catch(() => '')).trim().toLowerCase();
  const titleText = (await title.getText().catch(() => '')).trim().toLowerCase();
  const knownError = messageText === 'something went wrong'
    || (titleText === 'cinescape' && (messageText === '' || messageText === 'null'));
  if (!knownError) return;

  const confirm = app.$('id=com.cinescape:id/positive_btn');
  await confirm.click();
  await app.pause(500);
};

const waitForAppEntryState = async (app: AndroidApp) => {
  const skip = app.$('id=com.cinescape:id/textView81');
  const home = app.$('id=com.cinescape:id/homeUi');
  const errorMessage = app.$('id=com.cinescape:id/subtitle');
  const errorTitle = app.$('id=com.cinescape:id/title');
  // Sign In opened from the guest Account tab shows the form without its Skip link.
  const signInForm = app.$('id=com.cinescape:id/enterUsername');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await app.waitUntil(async () => {
      const message = (await errorMessage.getText().catch(() => '')).trim().toLowerCase();
      const title = (await errorTitle.getText().catch(() => '')).trim().toLowerCase();
      const knownError = message === 'something went wrong'
        || (title === 'cinescape' && (message === '' || message === 'null'));
      return (await skip.isDisplayed().catch(() => false))
        || (await home.isDisplayed().catch(() => false))
        || (await signInForm.isDisplayed().catch(() => false))
        || knownError;
    }, {
      timeout: 120_000, // UAT can keep the splash screen up for over a minute.
      timeoutMsg: 'The app did not reach Sign In, Home, or its known recoverable error state',
    });
    const message = (await errorMessage.getText().catch(() => '')).trim().toLowerCase();
    const title = (await errorTitle.getText().catch(() => '')).trim().toLowerCase();
    const knownError = message === 'something went wrong'
      || (title === 'cinescape' && (message === '' || message === 'null'));
    if (!knownError) return;
    await dismissGenericAppError(app);
    await app.pause(500);
    if (await skip.isDisplayed().catch(() => false) || await home.isDisplayed().catch(() => false)) return;
    await app.activateApp('com.cinescape');
  }
  await app.$('id=com.cinescape:id/textView81').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Cinescape did not recover to its Sign In screen after dismissing the startup error',
  });
};

export const enterAsGuest = async (app: AndroidApp) => {
  await waitForAppEntryState(app);
  const skip = app.$('id=com.cinescape:id/textView81');
  const home = app.$('id=com.cinescape:id/homeUi');
  if (!(await skip.isDisplayed()) && (await home.isDisplayed())) {
    const accountTab = app.$('id=com.cinescape:id/accountFragment');
    if (await accountTab.isDisplayed()) {
      await accountTab.click();
      if (await app.$('id=com.cinescape:id/btn_sign_in').isDisplayed()) {
        await app.$('id=com.cinescape:id/homeFragment').click();
        await home.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The guest home screen did not reappear' });
        return;
      }
    }
    test.skip(true, 'Guest coverage requires a signed-out app state; the installed app is already signed in.');
  }
  await skip.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The Sign in screen did not appear' });
  await skip.click();
  await app.$('id=com.cinescape:id/homeUi').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'The home screen did not appear after choosing Skip',
  });
};

export type AndroidArea = 'home' | 'movies' | 'food' | 'account' | 'more';

const areaTabs: Record<AndroidArea, string> = {
  home: 'homeFragment',
  movies: 'movieFragment',
  food: 'foodFragment',
  account: 'accountFragment',
  more: 'moreFragment',
};

export const hasPrimaryCredentials = (config: AndroidConfig) =>
  Boolean(config.credentials.username && config.credentials.password);

export const hasSecondAccount = (config: AndroidConfig) =>
  Boolean(config.secondAccount.username && config.secondAccount.password);

export const hasKioskCustomer = (config: AndroidConfig) =>
  Boolean(config.kioskCustomer.username && config.kioskCustomer.password && config.kioskCustomer.otp);

export const hasPaymentCredentials = (config: AndroidConfig) =>
  Boolean(config.payment.cardNumber || config.payment.knetNumber || config.payment.giftCard);

export const signInAsUser = async (
  app: AndroidApp,
  config: AndroidConfig,
  account: 'primary' | 'secondary' | 'kiosk' = 'primary',
) => {
  await waitForAppEntryState(app);
  const credentials = account === 'primary'
    ? config.credentials
    : account === 'secondary'
      ? config.secondAccount
      : { ...config.kioskCustomer, pin: config.kioskCustomer.otp };
  if (!credentials.username || !credentials.password) {
    throw new Error(account === 'primary'
      ? 'Set ANDROID_TEST_USERNAME / ANDROID_TEST_PASSWORD or TEST_USERNAME / TEST_PASSWORD for authenticated coverage.'
      : account === 'secondary'
        ? 'Set ANDROID_TEST2_USERNAME / ANDROID_TEST2_PASSWORD or TEST2_USERNAME / TEST2_PASSWORD for secondary-account coverage.'
        : 'Set KIOSK_TEST_USERNAME, KIOSK_TEST_PASSWORD and KIOSK_TEST_OTP in the sibling Kiosk UI project .env.');
  }
  const home = app.$('id=com.cinescape:id/homeUi');
  const accountName = app.$('id=com.cinescape:id/text_user_account_name');
  const username = app.$('id=com.cinescape:id/enterUsername');
  const password = app.$('id=com.cinescape:id/enterpassword');
  if (!(await username.isDisplayed()) && (await home.isDisplayed())) {
    throw new Error('The app is already signed in; sign-in coverage requires a fresh signed-out app state.');
  }
  /* Some app launches leave the sign-in form mounted but not visible. Route through
     guest Home and Account so the sign-in CTA opens the active form before locating fields. */
  if (!(await username.isDisplayed())) {
    const skip = app.$('id=com.cinescape:id/textView81');
    if (await skip.isDisplayed().catch(() => false)) {
      await skip.click();
      await home.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Skip did not open guest Home before sign-in' });
      await app.$('id=com.cinescape:id/accountFragment').click();
      const signIn = app.$('id=com.cinescape:id/btn_sign_in');
      await signIn.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Guest Account did not offer Sign In' });
      await signIn.click();
    }
  }
  await username.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The sign-in email field was not displayed' });
  await password.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The sign-in password field was not displayed' });
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  const clearCredentials = async () => {
    const inputs = await app.$$('android.widget.EditText');
    const inputCount = await inputs.length;
    const clearing: Promise<void>[] = [
      username.clearValue().catch(() => undefined),
      password.clearValue().catch(() => undefined),
    ];
    for (let index = 0; index < inputCount; index += 1) {
      clearing.push(inputs[index].clearValue().catch(() => undefined));
    }
    await Promise.all(clearing);
  };
  let isAuthenticated = false;
  let isOnHomeScreen = false;
  try {
    await username.setValue(credentials.username);
    await password.setValue(credentials.password);
    await app.$('id=com.cinescape:id/btn_sign_in').click();

    const otpField = app.$('id=com.cinescape:id/textView146');
    await app.waitUntil(
      async () => (await home.isDisplayed()) || (await accountName.isDisplayed()) || (await otpField.isDisplayed()),
      { timeout: 45_000, timeoutMsg: 'Sign-in did not open an authenticated screen or the email OTP challenge' },
    );
    isAuthenticated = (await home.isDisplayed()) || (await accountName.isDisplayed());
    isOnHomeScreen = await home.isDisplayed();
    if (!isAuthenticated) {
      const pin = credentials.pin;
      if (!pin) {
        throw new Error(`Configure the ${account === 'kiosk' ? 'KIOSK_TEST_OTP' : account === 'primary' ? 'ANDROID_TEST_PIN / TEST_PIN' : 'ANDROID_TEST2_PIN / TEST2_PIN'} value for the email OTP challenge.`);
      }
      await otpField.setValue(pin);
      if ((await otpField.getAttribute('text')) !== pin) {
        throw new Error('The configured email OTP was not entered into the verification field.');
      }
      await app.hideKeyboard();
      const submitOtp = app.$('id=com.cinescape:id/textView150');
      await submitOtp.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'The email OTP Submit button was not displayed' });
      await submitOtp.click();

      try {
        await app.waitUntil(
          async () => (await home.isDisplayed()) || (await accountName.isDisplayed()),
          {
            timeout: 45_000,
            timeoutMsg: 'Configured credentials did not reach an authenticated screen.',
          },
        );
        isOnHomeScreen = await home.isDisplayed();
      } catch (error) {
        const otpStillVisible = await app.$('id=com.cinescape:id/textView146').isDisplayed().catch(() => false);
        if (otpStillVisible) {
          throw new Error(
            'The app is still on the email OTP verification screen after submitting the configured PIN; '
              + 'the UAT account did not authenticate.',
            { cause: error },
          );
        }
        throw error;
      }
      isAuthenticated = true;
    }
  } catch (error) {
    await clearCredentials();
    throw error;
  } finally {
    if (wasRecording && isAuthenticated && isOnHomeScreen) {
      await app.startRecordingScreen({
        timeLimit: String(config.videoSeconds),
        bitRate: '4000000',
        forceRestart: true,
      });
    }
  }
};

export const openArea = async (app: AndroidApp, area: AndroidArea) => {
  await dismissGenericAppError(app);
  const tab = app.$(`id=com.cinescape:id/${areaTabs[area]}`);
  for (let backCount = 0; backCount < 5 && !(await tab.isDisplayed().catch(() => false)); backCount += 1) {
    await app.back();
    await app.pause(500);
  }
  await tab.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: `The ${area} navigation tab was not displayed`,
  });
  await tab.click();
};

export const openMoviesList = async (app: AndroidApp) => {
  await openArea(app, 'movies');
  const movieCard = app.$('id=com.cinescape:id/card_now_showing');
  await movieCard.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'No Now Showing movie cards loaded' });
  return movieCard;
};

export type MovieCard = { title: string; rating: string; category: string };

/** Scrolls the whole movie grid (Now Showing) and returns every card once, then returns to its top. */
export const readMovieList = async (app: AndroidApp) => {
  const movies = new Map<string, MovieCard>();
  const grid = await app.$(id('fragmentMovie'));
  const scroll = (direction: 'up' | 'down') =>
    app.execute('mobile: scrollGesture', { elementId: grid.elementId, direction, percent: 0.6 }) as Promise<boolean>;
  // The grid keeps loading cards after it first appears, so the end only counts once a second
  // scroll, a few seconds later, still cannot move.
  for (let page = 0, ends = 0; page < 40 && ends < 2; page += 1) {
    for (const card of await app.$$(id('card_now_showing'))) {
      // $$ returns at once when a cut-off card lacks the field, where $ would wait for it.
      const read = async (name: string) => {
        const [field] = await card.$$(id(name));
        return field ? (await field.getText().catch(() => '')).trim() : '';
      };
      const title = await read('text_movie_title');
      const rating = await read('movieRating');
      // A card cut off at the screen edge may show its title but not its rating; the next page completes it.
      if (title && rating) movies.set(title, { title, rating, category: await read('text_movie_category') });
    }
    if (await scroll('down')) ends = 0;
    else {
      ends += 1;
      await app.pause(2_500);
    }
  }
  for (let page = 0; page < 40 && await scroll('up'); page += 1);
  return [...movies.values()];
};

export const openFirstMovieDetails = async (app: AndroidApp) => {
  const movieCard = await openMoviesList(app);
  const title = (await movieCard.$('id=com.cinescape:id/text_movie_title').getText()).trim();
  if (!title) throw new Error('The first Now Showing movie card has no accessible title.');

  const poster = movieCard.$('id=com.cinescape:id/image_now_showing');
  await poster.waitForDisplayed({ timeout: 15_000, timeoutMsg: `Poster for "${title}" was not displayed` });
  await poster.click();
  await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: `Movie details did not open for "${title}"`,
  });
  return { movieCard, title };
};

export const tapElementCenter = async (app: AndroidApp, element: ChainablePromiseElement) => {
  const location = await element.getLocation();
  const size = await element.getSize();
  await app.execute('mobile: clickGesture', {
    x: Math.round(location.x + size.width / 2),
    y: Math.round(location.y + size.height / 2),
  });
};

export const tapNativeElementCenter = async (app: AndroidApp, element: WebdriverIO.Element) => {
  const location = await element.getLocation();
  const size = await element.getSize();
  await app.execute('mobile: clickGesture', {
    x: Math.round(location.x + size.width / 2),
    y: Math.round(location.y + size.height / 2),
  });
};

export const selectFutureDateWithShowtimes = async (app: AndroidApp) => {
  const dates = await app.$$('id=com.cinescape:id/card_day_date');
  const dateCount = await dates.length;
  if (dateCount < 2) throw new Error('The selected movie does not offer a future booking date.');
  const dateLabels = await dates.map(async (date) => (
    await date.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));

  for (let index = 1; index < dateCount; index += 1) {
    const currentDates = await app.$$('id=com.cinescape:id/card_day_date');
    // The strip scrolls sideways; only the chips on screen can be tapped.
    if (!currentDates[index]) break;
    const dateText = (await currentDates[index].$$('android.widget.TextView'))[1];
    await tapElementCenter(app, dateText);
    // Showtimes load a moment after the date is chosen.
    await app.waitUntil(async () => await app.$$('id=com.cinescape:id/card_scroll').length > 0, { timeout: 8_000 })
      .catch(() => undefined);
    await app.pause(500);
    const showtimes = await app.$$('id=com.cinescape:id/card_scroll');
    if (await showtimes.length > 0) return { dateLabel: dateLabels[index], showtimes };
  }

  throw new Error(`No future date has an available showtime. Dates checked: ${dateLabels.join(' | ')}`);
};

/** Today's showtimes on the open movie (today is selected when movie details open). */
const todaysShowtimes = async (app: AndroidApp) => {
  await app.$('id=com.cinescape:id/card_day_date').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Movie details did not show its dates' });
  await app.pause(1_500);
  const showtimes = await app.$$('id=com.cinescape:id/card_scroll');
  if (await showtimes.length === 0) test.skip(true, 'The first movie has no showtimes left today.');
  return { dateLabel: 'Today', showtimes };
};

/** Opens the first movie's next-day (or today's) show in General and selects one available seat (no checkout yet). */
export const selectOneSeat = async (
  app: AndroidApp,
  snap: (label: string) => Promise<void>,
  caseId: string,
  day: 'future' | 'today' = 'future',
) => {
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = day === 'future' ? await selectFutureDateWithShowtimes(app) : await todaysShowtimes(app);
  if (await showtimes.length === 0) throw new Error(`No showtime was available for ${dateLabel}.`);
  const showtimeLabel = (await showtimes[0].$$('android.widget.TextView')
    .map(async (label) => (await label.getText()).trim())).filter(Boolean).join(' ');
  await tapElementCenter(app, showtimes[0]);

  const categoryScreen = app.$('id=com.cinescape:id/select_seat_category');
  await categoryScreen.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The showtime did not open seat categories' });
  const generalCategory = app.$('android=new UiSelector().text("General")');
  await generalCategory.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'General seat category is unavailable' });
  await generalCategory.click();
  await app.$('id=com.cinescape:id/text_proceeds').click();

  const progress = app.$('id=com.cinescape:id/progress');
  await progress.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'General did not start loading the seat map' });
  await progress.waitForDisplayed({
    reverse: true,
    timeout: 60_000,
    timeoutMsg: 'The seat map did not finish loading',
  });
  const seatTable = app.$('id=com.cinescape:id/seat_table');
  const seatCells = await seatTable.$$('android.widget.TextView');
  let selected: WebdriverIO.Element | undefined;
  let currentRow = '';
  let seatRow = '';
  let seatNumber = '';
  for (const cell of seatCells) {
    const label = (await cell.getText()).trim();
    if (/^[A-Z]$/.test(label)) {
      currentRow = label;
    } else if (/^\d+$/.test(label) && await cell.isEnabled()) {
      selected = cell;
      seatRow = currentRow;
      seatNumber = label;
      break;
    }
  }
  if (!selected) throw new Error('The seat map has no available numbered seat.');
  await tapNativeElementCenter(app, selected);
  await snap(`${caseId}: one seat selected for ${title}`);
  return { title, dateLabel, showtimeLabel, seatRow, seatNumber, progress };
};

/** Opens a one-seat future-show checkout without submitting any payment. */
export const openSingleSeatCheckout = async (
  app: AndroidApp,
  snap: (label: string) => Promise<void>,
  caseId: string,
) => {
  const { title, dateLabel, showtimeLabel, seatRow, seatNumber, progress } = await selectOneSeat(app, snap, caseId);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  await progress.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The selected seat did not start checkout' });
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000, timeoutMsg: 'Checkout did not finish loading' });

  const checkout = app.$('id=com.cinescape:id/uiCheckout');
  const paymentList = app.$('id=com.cinescape:id/paymentLayout');
  await app.waitUntil(async () => (await checkout.isDisplayed()) || (await paymentList.isDisplayed()), {
    timeout: 20_000,
    timeoutMsg: 'The selected seat did not open checkout/payment options',
  });
  await snap(`${caseId}: checkout opened for ${title}`);
  return { title, dateLabel, showtimeLabel, seatRow, seatNumber, checkout, paymentList };
};

/** Registers a fresh UAT account; useful when a case specifically needs a zero wallet balance. */
export const registerFreshTestAccount = async (app: AndroidApp, config: AndroidConfig) => {
  const { email, firstName, lastName, password, mobile, dateOfBirth, gender } = config.newUser;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('The generated test-user email is not valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== dateOfBirth) {
    throw new Error('ANDROID_TEST_NEW_USER_DATE_OF_BIRTH must be a valid date in YYYY-MM-DD format.');
  }
  if (gender !== 'male' && gender !== 'female') throw new Error('ANDROID_TEST_NEW_USER_GENDER must be male or female.');

  await waitForAppEntryState(app);
  const signupNavigation = app.$('id=com.cinescape:id/textView108');
  for (let launchAttempt = 0; launchAttempt < 2 && !(await signupNavigation.isDisplayed().catch(() => false)); launchAttempt += 1) {
    await app.activateApp(config.appPackage);
    await waitForAppEntryState(app);
  }
  await signupNavigation.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The sign-in screen did not offer registration' });
  await signupNavigation.click();
  const signup = app.$('id=com.cinescape:id/signupUi');
  await signup.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The registration form did not open' });
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);

  const fields = ['enter_emails', 'enter_first_names', 'enter_last_names', 'enter_passwords', 'enter_confirm_passwords'];
  const otpEmail = app.$('id=com.cinescape:id/textView146');
  const otpMobile = app.$('id=com.cinescape:id/textView149');
  let authenticated = false;
  try {
    await app.$('id=com.cinescape:id/enter_emails').setValue(email);
    await app.$('id=com.cinescape:id/enter_first_names').setValue(firstName);
    await app.$('id=com.cinescape:id/enter_last_names').setValue(lastName);
    await app.$('id=com.cinescape:id/enter_passwords').setValue(password);
    await app.$('id=com.cinescape:id/enter_confirm_passwords').setValue(password);
    await app.hideKeyboard();
    await app.execute('mobile: swipeGesture', { left: 80, top: 900, width: 920, height: 1300, direction: 'up', percent: 0.75 });
    await app.$('id=com.cinescape:id/editTextPhone').setValue(mobile);
    await app.hideKeyboard();

    await app.$('id=com.cinescape:id/enter_date_births').click();
    await app.$('id=android:id/date_picker_header_year').click();
    const yearPicker = app.$('id=android:id/date_picker_year_picker');
    const yearPickerId = await yearPicker.elementId;
    const findYearRow = async () => {
      const rows = await app.$$('id=android:id/text1');
      for (const row of rows) {
        if ((await row.getText().catch(() => '')).trim() === String(dob.getUTCFullYear())
          && await row.isDisplayed().catch(() => false)) return row;
      }
      return undefined;
    };
    let years = await app.$$('id=android:id/text1').map((element) => element.getText());
    let targetYear = await findYearRow();
    for (let i = 0; !targetYear && i < 40; i += 1) {
      const prior = years;
      await app.execute('mobile: scrollGesture', { elementId: yearPickerId, direction: 'up', percent: 0.55 });
      years = await app.$$('id=android:id/text1').map((element) => element.getText());
      if (years.join('|') === prior.join('|')) break;
      targetYear = await findYearRow();
    }
    if (!targetYear) throw new Error(`DOB year ${dob.getUTCFullYear()} was not available. Visible year rows: ${years.map((year) => year.trim()).join(', ')}`);
    await targetYear.click();
    const headerDate = await app.$('id=android:id/date_picker_header_date').getText();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthNow = months.findIndex((month) => headerDate.includes(month));
    if (monthNow < 0) throw new Error('Could not read the DOB date-picker month.');
    const back = (monthNow - dob.getUTCMonth() + 12) % 12;
    const forward = (dob.getUTCMonth() - monthNow + 12) % 12;
    const direction = back <= forward ? 'prev' : 'next';
    for (let i = 0; i < Math.min(back, forward); i += 1) await app.$(`id=android:id/${direction}`).click();
    await app.$(`android=new UiSelector().text("${dob.getUTCDate()}")`).click();
    await app.$('id=android:id/button1').click();
    await app.$(`id=com.cinescape:id/${gender}`).click();
    await app.execute('mobile: swipeGesture', { left: 80, top: 900, width: 920, height: 1300, direction: 'up', percent: 0.75 });
    await app.$('id=com.cinescape:id/signup_btn').click();

    await otpEmail.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Registration did not open email OTP verification' });
    await otpEmail.setValue(config.newUserOtp);
    if (await otpMobile.isDisplayed().catch(() => false)) await otpMobile.setValue(config.newUserOtp);
    await app.$('id=com.cinescape:id/textView150').click();
    const home = app.$('id=com.cinescape:id/homeUi');
    const personalization = app.$('id=com.cinescape:id/btn_get_personal');
    await app.waitUntil(async () => (await home.isDisplayed()) || (await personalization.isDisplayed()), {
      timeout: 60_000,
      timeoutMsg: 'The new account did not reach Home or personalization after OTP verification',
    });
    if (await personalization.isDisplayed().catch(() => false)) {
      const skipPersonalization = app.$('id=com.cinescape:id/text_skip_proceed');
      const done = app.$('id=com.cinescape:id/done_btn');
      for (let scroll = 0; scroll < 4; scroll += 1) {
        if (await home.isDisplayed().catch(() => false)
          || await skipPersonalization.isDisplayed().catch(() => false)
          || await done.isDisplayed().catch(() => false)) break;
        await app.execute('mobile: swipeGesture', {
          left: 80,
          top: 900,
          width: 920,
          height: 1300,
          direction: 'up',
          percent: 0.75,
        });
      }
      await app.waitUntil(async () =>
        (await home.isDisplayed())
        || (await skipPersonalization.isDisplayed().catch(() => false))
        || (await done.isDisplayed().catch(() => false)),
      { timeout: 20_000, timeoutMsg: 'Personalization did not show its choices or return to Home' });
      if (await home.isDisplayed().catch(() => false)) {
        authenticated = true;
      } else if (await skipPersonalization.isDisplayed().catch(() => false)) {
        await skipPersonalization.click();
      } else {
        await done.click();
      }
      await home.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Personalization did not continue to Home' });
    }
    authenticated = true;
  } catch (error) {
    if (await signup.isDisplayed().catch(() => false)) {
      for (const id of fields) await app.$(`id=com.cinescape:id/${id}`).clearValue().catch(() => undefined);
      await app.$('id=com.cinescape:id/editTextPhone').clearValue().catch(() => undefined);
    }
    await otpEmail.clearValue().catch(() => undefined);
    await otpMobile.clearValue().catch(() => undefined);
    throw error;
  } finally {
    if (wasRecording && authenticated) {
      await app.startRecordingScreen({ timeLimit: String(config.videoSeconds), bitRate: '4000000', forceRestart: true });
    }
  }
};

export const beginCaseJourney = async (
  app: AndroidApp,
  config: AndroidConfig,
  snap: (label: string) => Promise<void>,
  area: AndroidArea,
  needsAccount: boolean,
  caseId: string,
  account: 'primary' | 'secondary' | 'kiosk' = 'primary',
) => {
  if (needsAccount) {
    await signInAsUser(app, config, account);
    if (area === 'account') {
      await openArea(app, 'home');
      await snap(`${caseId}: signed-in home screen`);
    } else {
      await openArea(app, area);
      await snap(`${caseId}: ${area} area opened`);
    }
    return;
  }

  await enterAsGuest(app);
  await snap(`${caseId}: guest home screen`);
  await openArea(app, area);
  await snap(`${caseId}: ${area} area opened`);
};

/** Reads a KWD amount such as "Wallet Balance: KWD 294.500" or "KWD3.500". */
export const readKwd = (text: string, label: string) => {
  const match = /(?:KWD|KD)?\s*([\d,]+(?:\.\d{1,3})?)/i.exec(text);
  // A newly registered account renders the "Wallet Balance:" label without a number for KWD 0.000.
  if (!match && /wallet balance\s*:?\s*$/i.test(text.trim())) return 0;
  if (!match) throw new Error(`${label} did not contain a readable KWD amount: ${text}`);
  return Number(match[1].replace(/,/g, ''));
};

const id = (name: string) => `id=com.cinescape:id/${name}`;
const byText = (text: string) => `android=new UiSelector().text("${text}")`;

/** Opens the Account tab scrolled to its top (wallet, Bookings, History, Recharge Wallet). */
export const openAccountTop = async (app: AndroidApp) => {
  await openArea(app, 'account');
  for (let swipe = 0; swipe < 4; swipe += 1) {
    await app.execute('mobile: swipeGesture', { left: 80, top: 600, width: 920, height: 1400, direction: 'down', percent: 0.9 });
  }
};

/** Opens the Account tab and returns the signed-in customer's wallet balance. */
export const readWalletBalance = async (app: AndroidApp, label = 'Wallet balance') => {
  await openAccountTop(app);
  const balance = app.$(id('text_user_wallet_kd'));
  // UAT sometimes sends the wallet details late; reopening Account asks for them again.
  for (let attempt = 0; attempt < 2 && !(await balance.waitForDisplayed({ timeout: 30_000 }).then(() => true, () => false)); attempt += 1) {
    await openArea(app, 'home');
    await app.pause(2_000);
    await openAccountTop(app);
  }
  await balance.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The Account screen did not show the wallet balance' });
  return readKwd(await balance.getText(), label);
};

/** Opens a one-seat checkout and continues to the payment-method list; nothing is paid. */
export const openPaymentMethods = async (
  app: AndroidApp,
  snap: (label: string) => Promise<void>,
  caseId: string,
) => {
  await openArea(app, 'movies');
  const booking = await openSingleSeatCheckout(app, snap, caseId);
  const totalElement = app.$(id('text_kd_total'));
  await totalElement.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Checkout did not show the booking total' });
  const total = readKwd(await totalElement.getText(), 'Booking total');
  // The review screen's summary of what was chosen, for comparing with the ticket later.
  const read = async (name: string) => (await app.$(id(name)).getText().catch(() => '')).trim();
  const review = {
    movie: await read('summary_name_movie'),
    location: await read('text_location_names'),
    date: await read('text_date_name'),
    time: await read('textView19'),
    screen: await read('txt_screen'),
    seats: await app.$$(id('seatNumber')).map(async (seat) => (await seat.getText()).trim()),
    ticketPrice: readKwd(await read('text_kds') || '0', 'Ticket price'),
    quantity: Number(await read('text_qty_number')) || 0,
  };
  const paymentList = app.$(id('paymentLayout'));
  if (!(await paymentList.isDisplayed().catch(() => false))) {
    await app.$(id('txt_proceed')).click();
    await paymentList.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Proceed did not open the payment-method list' });
  }
  await app.$(byText('SELECT PAYMENT METHODS')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The payment-method list did not load' });
  return { ...booking, total, review };
};

/** The "Amount to be paid" shown at the bottom of the payment-method list. */
export const amountToBePaid = async (app: AndroidApp) =>
  readKwd(await app.$(id('text_time_to_left')).getText(), 'Amount to be paid');

/** Opens one of the collapsible payment panels ("Use a Bank Offer", "Add a Gift Card", "Use your Wallet"). */
export const openPaymentPanel = async (app: AndroidApp, title: 'Use a Bank Offer' | 'Add a Gift Card' | 'Use your Wallet') => {
  const header = app.$(byText(title));
  await header.waitForDisplayed({ timeout: 15_000, timeoutMsg: `Payment methods did not offer "${title}"` });
  await header.click();
};

/** Reads and acknowledges the app's CINESCAPE message dialog, returning its message. */
export const acknowledgeAppMessage = async (app: AndroidApp, timeout = 30_000) => {
  const subtitle = app.$(id('subtitle'));
  await subtitle.waitForDisplayed({ timeout, timeoutMsg: 'The app did not show a message dialog' });
  const message = (await subtitle.getText()).trim();
  const ok = app.$(id('positive_btn'));
  if (await ok.isDisplayed().catch(() => false)) await ok.click();
  return message;
};

/** Waits for the confirmed-ticket screen after a successful payment and returns its Booking ID. */
export const waitForConfirmedBooking = async (app: AndroidApp, timeout = 120_000) => {
  const bookingId = app.$(id('text_bookin_id_no'));
  const failed = app.$(byText('FAILED!'));
  await app.waitUntil(async () => (await bookingId.isDisplayed().catch(() => false)) || (await failed.isDisplayed().catch(() => false)), {
    timeout,
    timeoutMsg: 'Payment did not reach the confirmed ticket or the payment-failed screen',
  });
  if (await failed.isDisplayed().catch(() => false)) {
    throw new Error(`The payment failed: ${(await app.$(id('textView61')).getText().catch(() => '')).trim()}`);
  }
  // The ticket screen opens before its Booking ID text is filled in.
  let value = '';
  await app.waitUntil(async () => /^[A-Z0-9]{5,}$/i.test(value = (await bookingId.getText().catch(() => '')).trim()), {
    timeout: 60_000,
    timeoutMsg: 'The confirmed ticket did not show a valid Booking ID',
  }).catch(() => {
    throw new Error(`The confirmed ticket shows no valid Booking ID: "${value}"`);
  });
  return value;
};

/** Pays the open payment-method list fully with the wallet and returns the Booking ID. */
export const payWithWallet = async (app: AndroidApp) => {
  await openPaymentPanel(app, 'Use your Wallet');
  const apply = app.$(id('textview_bt_wallet_apply'));
  await apply.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Wallet details did not show Apply' });
  await apply.click();
  // Applying covers the amount (Apply turns into Cancel); Proceed then confirms the booking.
  await app.$(id('textview_bt_wallet_cancel')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The wallet was not applied to the booking' });
  await app.waitUntil(async () => (await amountToBePaid(app)) === 0, {
    timeout: 15_000,
    timeoutMsg: 'Applying the wallet did not reduce the amount to be paid to KWD 0',
  });
  await app.$(id('txt_proceed')).click();
  return waitForConfirmedBooking(app);
};

/** Chooses KNET, completes the KNET test gateway with the configured test card and returns the Booking ID. */
export const payWithKnet = async (app: AndroidApp, config: AndroidConfig, snap: (label: string) => Promise<void>, caseId: string) => {
  const { knetNumber, knetExpiry, knetPin } = config.payment;
  if (!knetNumber || !/^\d{2}\/\d{2}$/.test(knetExpiry) || !/^\d{4}$/.test(knetPin)) {
    throw new Error('Set TEST_KNET_NUMBER, TEST_KNET_EXPIRY (MM/YY) and TEST_KNET_PIN (4 digits) for the KNET test gateway.');
  }
  await openKnetGateway(app);
  await snap(`${caseId}: KNET test gateway`);
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  try {
    // The gateway is a web page, so its fields carry plain HTML ids rather than app resource ids.
    await app.$('android=new UiSelector().resourceId("debitNumber")').setValue(knetNumber);
    const expiry = app.$('android=new UiSelector().resourceId("expiryDateInput")');
    await expiry.setValue(knetExpiry);
    if (!/^\d{2}\/\d{2}$/.test((await expiry.getText()).trim())) {
      await expiry.clearValue();
      await expiry.setValue(knetExpiry.replace(/\D/g, ''));
    }
    await app.$('android=new UiSelector().resourceId("cardPin")').setValue(knetPin);
    await app.hideKeyboard().catch(() => undefined);
    await app.$('android=new UiSelector().className("android.widget.Button").text("Submit")').click();
    // The test gateway may ask to confirm before returning to the app.
    const confirm = app.$('android=new UiSelector().className("android.widget.Button").text("Confirm")');
    const bookingId = app.$(id('text_bookin_id_no'));
    await app.waitUntil(async () => (await confirm.isDisplayed().catch(() => false))
      || (await bookingId.isDisplayed().catch(() => false))
      || !(await app.$(id('paymentView')).isDisplayed().catch(() => false)), {
      timeout: 60_000,
      timeoutMsg: 'The KNET gateway did not confirm or return to the app after Submit',
    });
    if (await confirm.isDisplayed().catch(() => false)) await confirm.click();
  } finally {
    if (wasRecording) {
      await app.startRecordingScreen({ timeLimit: String(config.videoSeconds), bitRate: '4000000', forceRestart: true });
    }
  }
  return waitForConfirmedBooking(app);
};

/** Chooses KNET and Proceed, and waits for the KNET test gateway page; nothing is entered. */
export const openKnetGateway = async (app: AndroidApp) => {
  const knet = app.$(id('knet'));
  await knet.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Payment methods did not offer KNET' });
  await knet.click();
  await app.$(id('txt_proceed')).click();
  await app.$('android=new UiSelector().resourceId("debitNumber")').waitForDisplayed({
    timeout: 90_000,
    timeoutMsg: 'The KNET test gateway did not load its card form',
  });
  // The gateway shows "Amount:" followed by e.g. "KD 3.500" (with a non-breaking space).
  const texts = [...(await app.getPageSource()).matchAll(/text="([^"]*)"/g)].map((match) => match[1].replace(/&#160;|00a0/g, ' '));
  const amount = texts.find((text) => /^KD\s*[\d.,]+$/i.test(text.trim()));
  return readKwd(amount ?? '', 'KNET gateway amount');
};

/** Chooses Credit Card and opens the in-app card form; returns the amount it asks for. */
export const openCreditCardForm = async (app: AndroidApp) => {
  const card = app.$(id('creditCard'));
  await card.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Payment methods did not offer Credit Card' });
  await card.click();
  await app.$(id('txt_proceed')).click();
  const amount = app.$(id('kd_to_pay'));
  await amount.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'Credit Card did not open the card-payment form' });
  return readKwd(await amount.getText(), 'Credit card amount');
};

/** Fills the in-app credit card form with the configured test card, pays and returns the Booking ID. */
export const payWithCreditCard = async (app: AndroidApp, config: AndroidConfig, snap: (label: string) => Promise<void>, caseId: string) => {
  const { cardNumber, cardExpiry, cardCvv } = config.payment;
  if (!cardNumber || !cardExpiry || !cardCvv) {
    throw new Error('Set TEST_CARD_NUMBER, TEST_CARD_EXPIRY and TEST_CARD_CVV for the credit card test payment.');
  }
  if (!(await app.$(id('kd_to_pay')).isDisplayed().catch(() => false))) await openCreditCardForm(app);
  await snap(`${caseId}: credit card form`);
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  try {
    await app.$(id('cardHolderTextInputEditText')).setValue('Auto Tester');
    // A bank offer fills in (and locks) the eligible card number; only an empty field is typed into.
    const numberField = app.$(id('cardNumberTextInputEditText'));
    if ((await numberField.getText()).replace(/\D/g, '').length < 12) await numberField.setValue(cardNumber);
    // The form only accepts MM/YY; it may insert the slash itself, so check what it shows.
    const expiry = app.$(id('expireDateTextInputEditText'));
    await expiry.setValue(cardExpiry);
    if (!/^\d{2}\/\d{2}$/.test((await expiry.getText()).trim())) {
      await expiry.clearValue();
      await expiry.setValue(cardExpiry.replace(/\D/g, ''));
    }
    await app.$(id('ccvTextInputEditText')).setValue(cardCvv);
    await app.hideKeyboard().catch(() => undefined);
    await app.$(id('btn_pay')).click();
  } finally {
    if (wasRecording) {
      await app.startRecordingScreen({ timeLimit: String(config.videoSeconds), bitRate: '4000000', forceRestart: true });
    }
  }
  // A 3-D Secure page may follow; the UAT test card is accepted with its default "Submit".
  const bookingId = app.$(id('text_bookin_id_no'));
  const failed = app.$(byText('FAILED!'));
  const submit3ds = app.$('android=new UiSelector().className("android.widget.Button").textMatches("(?i)submit|continue|authenticate")');
  const refusal = app.$(id('subtitle'));
  await app.waitUntil(async () => (await bookingId.isDisplayed().catch(() => false))
    || (await failed.isDisplayed().catch(() => false))
    || (await submit3ds.isDisplayed().catch(() => false))
    || (await refusal.isDisplayed().catch(() => false)), {
    timeout: 120_000,
    timeoutMsg: 'The credit card payment did not reach 3-D Secure, the ticket or a failure screen',
  });
  if (await refusal.isDisplayed().catch(() => false)) {
    // Seen on UAT 7 Oct 2026 with the configured test card: "Something went wrong, Please try again."
    throw new Error(`The app refused the credit card payment: "${(await refusal.getText()).trim()}"`);
  }
  if (await submit3ds.isDisplayed().catch(() => false)) {
    await snap(`${caseId}: 3-D Secure page`);
    await submit3ds.click();
  }
  return waitForConfirmedBooking(app);
};

/** Cancels an unpaid checkout or payment list and confirms, returning to the app. */
export const cancelUnpaidCheckout = async (app: AndroidApp) => {
  const cancel = app.$(id('text_cancel'));
  if (!(await cancel.isDisplayed().catch(() => false))) return;
  await cancel.click();
  const sure = app.$(id('consSure'));
  const sureText = app.$(id('txtSureNew'));
  await app.waitUntil(async () => (await sure.isDisplayed().catch(() => false)) || (await sureText.isDisplayed().catch(() => false)), {
    timeout: 10_000,
    timeoutMsg: 'Cancelling checkout did not ask for confirmation',
  });
  if (await sure.isDisplayed().catch(() => false)) await sure.click(); else await sureText.click();
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Cancelling checkout did not return to movie details' })
    .catch(() => undefined);
};

/**
 * Walks Account > Your Upcoming Bookings, opening each card's ticket to read its Booking ID.
 * Only the cards on screen exist in the UI tree, so the list is scrolled until it stops moving.
 * Stops with the ticket open when `stopAt` is found; otherwise returns every Booking ID.
 */
const walkUpcomingTickets = async (app: AndroidApp, stopAt?: string) => {
  await openAccountTop(app);
  const heading = app.$(id('text_upcoming_booking'));
  await heading.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Account did not show Your Upcoming Bookings' }).catch(() => undefined);
  const ids: string[] = [];
  let previousScreen = '';
  for (let page = 0; page < 30; page += 1) {
    const cardCount = await app.$$(id('imageView7')).length;
    for (let index = 0; index < cardCount; index += 1) {
      const card = (await app.$$(id('imageView7')))[index];
      if (!card) break;
      const { y } = await card.getLocation();
      const { height } = await card.getSize();
      // Only tap cards fully inside the Account content area (below the header, above the tab bar).
      if (y < 283 || y + height > 2253) continue;
      await card.click();
      const ticketId = app.$(id('text_bookin_id_no'));
      await ticketId.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'An upcoming booking card did not open its ticket' });
      const bookingId = (await ticketId.getText()).trim();
      if (bookingId === stopAt) return ids;
      if (!ids.includes(bookingId)) ids.push(bookingId);
      await app.back();
      await app.$(id('recyclerview_booking')).waitForDisplayed({ timeout: 20_000, timeoutMsg: 'Back from the ticket did not return to Account' });
    }
    const screen = (await app.$$(id('txt_date')).map(async (el) => el.getLocation().then(({ y }) => y))).join(',')
      + (await app.$(id('text_upcoming_booking')).getLocation().then(({ y }) => y).catch(() => -1));
    if (screen === previousScreen || !(await app.$(id('recyclerview_booking')).isDisplayed().catch(() => false))) break;
    previousScreen = screen;
    await app.execute('mobile: swipeGesture', { left: 80, top: 1300, width: 920, height: 900, direction: 'up', percent: 0.6 });
    await app.pause(1_000);
  }
  if (stopAt) throw new Error(`Booking ${stopAt} is not listed under Your Upcoming Bookings (listed: ${ids.join(', ') || 'none'}).`);
  return ids;
};

/** Booking IDs listed under Account > Your Upcoming Bookings. */
export const upcomingBookingIds = (app: AndroidApp) => walkUpcomingTickets(app);

/** Opens the ticket for one Booking ID from Account > Your Upcoming Bookings. */
export const openUpcomingTicket = async (app: AndroidApp, bookingId: string) => {
  await walkUpcomingTickets(app, bookingId);
};

/** Reads the open ticket's details (movie, location, date/time, screen, category and seats). */
export const readTicketDetails = async (app: AndroidApp) => {
  const text = async (name: string) => (await app.$(id(name)).getText().catch(() => '')).trim();
  return {
    bookingId: await text('text_bookin_id_no'),
    movie: await text('text_film_house_name'),
    location: await text('text_location_names'),
    dateTime: (await text('txt_date')).replace(/\s+/g, ' '),
    screen: await text('txt_scrrens'),
    category: await text('categoryName'),
    seats: await app.$$(id('seatNumber')).map(async (seat) => (await seat.getText()).trim()),
    hasQrCode: await app.$(id('image_qr_code')).isDisplayed().catch(() => false),
  };
};

/** Cancels a confirmed booking from its ticket ("Cancel Reservation" > "Yes, I'm Sure"). */
export const cancelBooking = async (app: AndroidApp, bookingId: string) => {
  await openUpcomingTicket(app, bookingId);
  const cancel = app.$(id('textView48'));
  await cancel.waitForDisplayed({ timeout: 15_000, timeoutMsg: `The ticket for ${bookingId} did not offer Cancel Reservation` });
  await cancel.click();
  const sure = app.$(id('consSure'));
  await sure.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Cancel Reservation did not ask "ARE YOU SURE ?"' });
  await sure.click();
  // The app answers "Cancel booking successfully." and returns to Home after OK.
  const message = await acknowledgeAppMessage(app, 60_000);
  if (!/cancel(?:led)? booking successfully|cancelled successfully/i.test(message)) {
    throw new Error(`Cancelling ${bookingId} was refused: "${message}"`);
  }
  return message;
};

/**
 * Cancels a booking a test created when the test stopped before its own cancellation step,
 * so no paid booking is left on the test account. A failure is recorded in the report.
 */
export const cleanUpBooking = async (app: AndroidApp, bookingId: string) => {
  await cancelBooking(app, bookingId).catch((error: unknown) => {
    test.info().annotations.push({
      type: 'cleanup',
      description: `Booking ${bookingId} could not be cancelled automatically; cancel it on the test account. ${String(error)}`,
    });
  });
};

export type HistoryEntry = { title: string; date: string; status: string };

/** Opens Account > History and returns its entries, newest first. */
export const bookingHistory = async (app: AndroidApp) => {
  await openAccountTop(app);
  await app.$(id('view_historys')).click();
  const list = app.$(id('recyclerview_booking_history'));
  const empty = app.$(id('noHistory'));
  await app.waitUntil(async () => (await list.isDisplayed().catch(() => false)) || (await empty.isDisplayed().catch(() => false)), {
    timeout: 45_000,
    timeoutMsg: 'History showed neither entries nor an empty state',
  });
  const titles = await app.$$(id('text_booking_history_title')).map(async (el) => (await el.getText()).trim());
  const dates = await app.$$(id('text_booking_history_date')).map(async (el) => (await el.getText()).trim());
  const statuses = await app.$$(id('text_booking_history_time')).map(async (el) => (await el.getText()).trim());
  return titles.map((title, index): HistoryEntry => ({ title, date: dates[index] ?? '', status: statuses[index] ?? '' }));
};

/** Expands the first History entry and returns its Booking ID and Track ID. */
export const firstHistoryPaymentDetails = async (app: AndroidApp) => {
  await app.$(id('view_booking_history')).click();
  await app.$(id('tvTrackId')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The history entry did not expand its payment details' });
  const value = async (name: string) => (await app.$(id(name)).getText().catch(() => '')).trim();
  return { bookingId: await value('tvBookingIdNumber'), trackId: await value('tvTrackIdNumber') };
};

export type Preparation = 'Prepare Now' | 'Prepare Later';

/**
 * From the Food tab, chooses the Cinescape 360 pickup location and returns the preparation-time dialog.
 * Outside pickup hours the location is shown as closed and cannot be chosen, so the case is skipped.
 */
export const openFoodPreparationChoice = async (app: AndroidApp) => {
  const location = app.$(byText('Cinescape 360'));
  await location.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Food did not offer the Cinescape 360 pickup location' });
  await location.click();
  const prepareNow = app.$(id('btnPrepareNow'));
  const shown = await prepareNow.waitForDisplayed({ timeout: 15_000 }).then(() => true, () => false);
  if (!shown) {
    const hours = (await app.$(id('textView194')).getText().catch(() => '')).trim();
    test.skip(true, `Cinescape 360 food pickup is closed now (${hours || 'pickup hours not shown'}).`);
  }
  return { prepareNow, prepareLater: app.$(id('btnPrepareLater')) };
};

/** Starts a food-only order at Cinescape 360 with the given preparation time, ending on the food catalogue. */
export const startFoodOnlyOrder = async (app: AndroidApp, preparation: Preparation) => {
  const { prepareNow, prepareLater } = await openFoodPreparationChoice(app);
  await (preparation === 'Prepare Now' ? prepareNow : prepareLater).click();
  await app.$(id('text_food_select')).waitForDisplayed({ timeout: 30_000, timeoutMsg: `${preparation} did not open the food catalogue` });
};

/** Adds the first combo on the food catalogue with its Salt and Pepsi options; returns its name and price. */
export const addFirstCombo = async (app: AndroidApp) => {
  const name = (await app.$(id('text_combo')).getText()).trim();
  await app.$(id('text_add_btn')).click();
  const modifierDone = app.$(id('modifier_done'));
  const legacyDone = app.$(id('tv_done_btn'));
  await app.waitUntil(async () => (await modifierDone.isDisplayed().catch(() => false)) || (await legacyDone.isDisplayed().catch(() => false)), {
    timeout: 15_000,
    timeoutMsg: `Adding ${name} did not open the item options`,
  });
  await app.$(byText('Salt')).click();
  await app.$(byText('Pepsi')).click();
  const total = (await modifierDone.isDisplayed().catch(() => false)) ? app.$(id('modifier_total_price')) : app.$(id('tv_kd_total'));
  const price = readKwd(await total.getText(), `${name} price`);
  await ((await modifierDone.isDisplayed().catch(() => false)) ? modifierDone : legacyDone).click();
  await app.$(id('text_cart_count_notiication')).waitForDisplayed({ timeout: 15_000, timeoutMsg: `${name} was not added to the cart` });
  return { name, price };
};

/** Reads the open food cart: the first item's quantity and price, and the cart total. */
export const readFoodCart = async (app: AndroidApp) => ({
  quantity: Number((await app.$(id('text_number')).getText()).trim()),
  itemPrice: readKwd(await app.$(id('tvKD')).getText(), 'Cart item price'),
  total: readKwd(await app.$(id('text_total1')).getText(), 'Cart total'),
});

/** Taps + or − on the first cart item and waits for its quantity to change. */
export const changeFoodQuantity = async (app: AndroidApp, change: 'increase' | 'decrease') => {
  const before = (await readFoodCart(app)).quantity;
  const expected = before + (change === 'increase' ? 1 : -1);
  await app.$(id(`text_${change}`)).click();
  await app.waitUntil(async () => (await readFoodCart(app).catch(() => ({ quantity: -1 }))).quantity === expected, {
    timeout: 10_000,
    timeoutMsg: `Tapping ${change} did not change the cart quantity from ${before} to ${expected}`,
  });
  await app.pause(1_000);
  return readFoodCart(app);
};

/**
 * Pays the open payment-method list fully with the wallet for a food order and returns the Booking ID.
 * Food orders first show a "One Click & Your Snacks Are Ready" help page, which is closed.
 */
export const payFoodWithWallet = async (app: AndroidApp) => {
  await openPaymentPanel(app, 'Use your Wallet');
  const apply = app.$(id('textview_bt_wallet_apply'));
  await apply.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Wallet details did not show Apply' });
  await apply.click();
  await app.$(id('textview_bt_wallet_cancel')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The wallet was not applied to the food order' });
  await app.waitUntil(async () => (await amountToBePaid(app)) === 0, {
    timeout: 15_000,
    timeoutMsg: 'Applying the wallet did not reduce the amount to be paid to KWD 0',
  });
  await app.$(id('txt_proceed')).click();
  // The help page can open over the confirmation after it first appears, so it is closed whenever shown.
  const help = app.$(id('btnClose'));
  const bookingId = app.$(id('text_bookin_id_no'));
  let value = '';
  await app.waitUntil(async () => {
    if (await help.isDisplayed().catch(() => false)) await help.click().catch(() => undefined);
    if (await app.$(byText('FAILED!')).isDisplayed().catch(() => false)) {
      throw new Error(`The food payment failed: ${(await app.$(id('textView61')).getText().catch(() => '')).trim()}`);
    }
    value = (await bookingId.getText().catch(() => '')).trim();
    return /^[A-Z0-9]{5,}$/i.test(value) && !(await help.isDisplayed().catch(() => false));
  }, { timeout: 150_000, interval: 1_500, timeoutMsg: 'Paying the food order did not reach a confirmation with a Booking ID' });
  return value;
};

/** Reads the Food Order cards under Account > Your Upcoming Bookings: location, date and pickup action or status. */
export const upcomingFoodOrders = async (app: AndroidApp) => {
  await openAccountTop(app);
  await app.$(id('text_upcoming_booking')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Account did not show Your Upcoming Bookings' });
  await app.pause(2_000);
  const orders: { location: string; date: string; action: string }[] = [];
  for (const title of await app.$$(byText('Food Order'))) {
    const { y } = await title.getLocation();
    const below = async (name: string) => {
      for (const element of await app.$$(id(name))) {
        const top = (await element.getLocation()).y;
        if (top > y && top < y + 700) return (await element.getText()).trim();
      }
      return '';
    };
    orders.push({
      location: await below('text_location_names'),
      date: await below('txt_date'),
      action: (await below('food_pickup_btn')) || (await below('textView167')),
    });
  }
  return orders;
};

/**
 * Scrolls Account > Your Upcoming Bookings to a food order still waiting for "Prepare Food" and returns
 * that card's location and date with its button, or undefined when no order is held.
 */
export const findHeldFoodOrder = async (app: AndroidApp) => {
  await openAccountTop(app);
  await app.$(id('text_upcoming_booking')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Account did not show Your Upcoming Bookings' });
  await app.pause(2_000);
  const button = app.$('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("com.cinescape:id/food_pickup_btn"))');
  if (!(await button.isDisplayed().catch(() => false))) return undefined;
  // Keep the whole card above the tab bar before reading it.
  const { y } = await button.getLocation();
  if (y > 1900) {
    await app.execute('mobile: swipeGesture', { left: 80, top: 1300, width: 920, height: 700, direction: 'up', percent: 0.5 });
    await app.pause(800);
  }
  const held = app.$(id('food_pickup_btn'));
  const buttonY = (await held.getLocation()).y;
  const nearest = async (name: string) => {
    let best = { distance: Infinity, text: '' };
    for (const element of await app.$$(id(name))) {
      const distance = buttonY - (await element.getLocation()).y;
      if (distance >= -150 && distance < best.distance) best = { distance, text: (await element.getText()).trim() };
    }
    return best.text;
  };
  return { location: await nearest('text_location_names'), date: await nearest('txt_date'), button: held };
};

/** Taps "Prepare Food" on a held order and confirms; returns the pickup status the card then shows (e.g. "17 - In Queue"). */
export const prepareHeldFood = async (app: AndroidApp, button: ChainablePromiseElement) => {
  const { y } = await button.getLocation();
  await button.click();
  const subtitle = app.$(id('subtitle'));
  await subtitle.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Prepare Food did not ask for confirmation' });
  const question = (await subtitle.getText()).trim();
  // On this dialog "Yes" is the button with the negative_btn id.
  await app.$('android=new UiSelector().resourceId("com.cinescape:id/negative_btn").text("Yes")').click();
  let status = '';
  await app.waitUntil(async () => {
    for (const label of await app.$$(id('textView167'))) {
      const top = (await label.getLocation()).y;
      const text = (await label.getText()).trim();
      if (Math.abs(top - y) < 200 && /^\d+\s*-\s*\S/.test(text)) return Boolean(status = text);
    }
    return false;
  }, { timeout: 30_000, timeoutMsg: 'The order did not show a pickup number after Prepare Food' });
  return { question, status };
};

/**
 * True when an on-screen image is blank or a placeholder: 90% or more of its pixels share one colour.
 * Real posters and banners stay well below that (a white-backed promotion measured 83%), while a missing
 * location image (black with a small arrow) measured 95%. The image is cropped from a full screenshot.
 */
export const imageIsBlank = async (app: AndroidApp, element: WebdriverIO.Element, screenshot?: Buffer) =>
  (await measureImage(app, element, screenshot)).blank;

/** Crops an on-screen image from a screenshot and measures the share of its most common colour (see imageIsBlank). */
export const measureImage = async (app: AndroidApp, element: WebdriverIO.Element, screenshot?: Buffer) => {
  const shot = screenshot ?? Buffer.from(await app.takeScreenshot(), 'base64');
  const { width: screenWidth = 0, height: screenHeight = 0 } = await sharp(shot).metadata();
  const { x, y } = await element.getLocation();
  const { width, height } = await element.getSize();
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const region = {
    left,
    top,
    width: Math.min(Math.round(width), screenWidth - left),
    height: Math.min(Math.round(height), screenHeight - top),
  };
  // Slivers of images cut off at the screen edge are not judged.
  if (region.width < 150 || region.height < 150) return { judged: false, blank: false, dominantShare: NaN, crop: undefined };
  const crop = await sharp(shot).extract(region).png().toBuffer();
  const { data, info } = await sharp(crop).raw().toBuffer({ resolveWithObject: true });
  // Colours are grouped into 16 levels per channel so compression noise does not split one flat colour.
  const counts = new Map<number, number>();
  for (let index = 0; index < data.length; index += info.channels) {
    const key = ((data[index] >> 4) << 8) | ((data[index + 1] >> 4) << 4) | (data[index + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dominantShare = Math.max(...counts.values()) / (info.width * info.height);
  return { judged: true, blank: dominantShare >= 0.9, dominantShare, crop };
};
