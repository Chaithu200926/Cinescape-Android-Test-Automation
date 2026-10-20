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
  if (!knownError) return false;

  const confirm = app.$('id=com.cinescape:id/positive_btn');
  await confirm.click();
  await app.pause(500);
  return true;
};

/**
 * Runs a step and, if it failed behind UAT's intermittent "Something Went Wrong" dialog,
 * dismisses the dialog and runs it once more. Each retry is recorded in the report.
 */
export const retryAfterAppError = async <T>(app: AndroidApp, step: string, action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    if (!(await dismissGenericAppError(app).catch(() => false))) throw error;
    test.info().annotations.push({ type: 'uat-error', description: `UAT showed "Something Went Wrong" during: ${step}; retried once.` });
    return action();
  }
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
    // A UAT "Something Went Wrong" dialog can appear while backing out and hides the tab bar.
    await dismissGenericAppError(app);
  }
  await app.waitUntil(async () => {
    await dismissGenericAppError(app);
    return tab.isDisplayed().catch(() => false);
  }, {
    timeout: 15_000,
    timeoutMsg: `The ${area} navigation tab was not displayed`,
  });
  await tab.click();
};

export const openMoviesList = async (app: AndroidApp) => retryAfterAppError(app, 'loading Now Showing', async () => {
  await openArea(app, 'movies');
  const movieCard = app.$('id=com.cinescape:id/card_now_showing');
  await movieCard.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'No Now Showing movie cards loaded' });
  return movieCard;
});

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

  await retryAfterAppError(app, `opening details for "${title}"`, async () => {
    const poster = movieCard.$('id=com.cinescape:id/image_now_showing');
    await poster.waitForDisplayed({ timeout: 15_000, timeoutMsg: `Poster for "${title}" was not displayed` });
    await poster.click();
    await app.$('id=com.cinescape:id/screenShowTime').waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: `Movie details did not open for "${title}"`,
    });
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

/** What each loading step leads to, so a step counts as started even if its spinner was never seen. */
export const seatMapScreen = ['id=com.cinescape:id/seat_table'];
export const checkoutScreen = ['id=com.cinescape:id/uiCheckout', 'id=com.cinescape:id/paymentLayout'];

/**
 * Waits out the loading step after a tap: the spinner appears, then clears. The Internal servers answer so fast
 * that the spinner can come and go between two polls, so the next screen showing up also counts as started.
 */
export const waitForLoadingStep = async (
  app: AndroidApp,
  nextScreen: string[],
  startMsg: string,
  finishMsg: string,
) => {
  const progress = app.$('id=com.cinescape:id/progress');
  const shown = async (selector: string) => app.$(selector).isDisplayed().catch(() => false);
  await app.waitUntil(async () => (await progress.isDisplayed().catch(() => false))
    || (await Promise.all(nextScreen.map(shown))).some(Boolean), { timeout: 15_000, timeoutMsg: startMsg });
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000, timeoutMsg: finishMsg });
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
  await waitForLoadingStep(app, seatMapScreen, 'General did not start loading the seat map', 'The seat map did not finish loading');
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
  const { title, dateLabel, showtimeLabel, seatRow, seatNumber } = await selectOneSeat(app, snap, caseId);
  await app.$('id=com.cinescape:id/txt_proceed').click();
  await waitForLoadingStep(app, checkoutScreen, 'The selected seat did not start checkout', 'Checkout did not finish loading');

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
    // On a heavily loaded PC (AND-49 runs two emulators) the sign-up request can fail with
    // "No internet connection"; the form keeps its values, so Sign up is pressed again.
    const noInternet = app.$('android=new UiSelector().resourceId("com.cinescape:id/subtitle").text("No internet connection")');
    for (let attempt = 1; ; attempt += 1) {
      await app.$('id=com.cinescape:id/signup_btn').click();
      await app.waitUntil(async () => (await otpEmail.isDisplayed().catch(() => false)) || (await noInternet.isDisplayed().catch(() => false)), {
        timeout: 30_000,
        timeoutMsg: 'Registration did not open email OTP verification',
      });
      if (!(await noInternet.isDisplayed().catch(() => false))) break;
      if (attempt === 3) throw new Error('Registration failed three times with "No internet connection"');
      test.info().annotations.push({ type: 'uat-error', description: `Sign-up attempt ${attempt} failed with "No internet connection"; retried.` });
      await app.$('id=com.cinescape:id/positive_btn').click();
      await app.pause(5_000);
    }
    await otpEmail.setValue(config.newUserOtp);
    if (await otpMobile.isDisplayed().catch(() => false)) await otpMobile.setValue(config.newUserOtp);
    await app.$('id=com.cinescape:id/textView150').click();
    const home = app.$('id=com.cinescape:id/homeUi');
    const personalization = app.$('id=com.cinescape:id/btn_get_personal');
    await app.waitUntil(async () => {
      // UAT's intermittent "Something Went Wrong" can cover the screen after verification.
      await dismissGenericAppError(app);
      return (await home.isDisplayed()) || (await personalization.isDisplayed());
    }, {
      timeout: 90_000,
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

/**
 * The Internal builds' web support chat (Pair AI agent) is open. Its "Powered by" footer shows only inside the open
 * chat; the title "Cinescape chat" stays in the screen tree on Account even when the chat is closed (UAT new app,
 * 18 Oct), and pressing Back on that false alarm walked the test off the Account screen.
 */
export const supportChatIsOpen = async (app: AndroidApp) =>
  app.$('//*[@text="Powered by"]').isDisplayed().catch(() => false);

/**
 * Closes the support chat when it is open: its own Close button ("إغلاق" in Arabic, the default language), else Back.
 * On the Internal builds it can open over the Account screen by itself, or from a tap or swipe meant for Account.
 */
export const closeSupportChat = async (app: AndroidApp) => {
  for (let attempt = 0; attempt < 3 && await supportChatIsOpen(app); attempt += 1) {
    const close = app.$('//*[@text="إغلاق" or @text="Close" or @content-desc="إغلاق" or @content-desc="Close"]');
    if (await close.isDisplayed().catch(() => false)) await close.click().catch(() => undefined);
    else await app.back();
    await app.pause(2_000);
  }
};

/**
 * Taps a control and waits (up to `timeout`) for what it opens. On the Internal builds the support-chat web view lies
 * over the Account screen while it loads, so a tap can open the chat instead; then the chat is closed and the tap repeated.
 */
export const tapPastSupportChat = async (app: AndroidApp, target: string, opens: string, timeoutMsg: string, timeout = 10_000) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await app.pause(1_500);
    await closeSupportChat(app);
    await app.$(target).click();
    if (await app.$(opens).waitForDisplayed({ timeout }).then(() => true, () => false)) return;
    if (!(await supportChatIsOpen(app))) break;
  }
  throw new Error(timeoutMsg);
};

/** Opens the Account tab scrolled to its top (wallet, Bookings, History, Recharge Wallet), with the support chat closed. */
export const openAccountTop = async (app: AndroidApp) => {
  await openArea(app, 'account');
  await closeSupportChat(app);
  for (let swipe = 0; swipe < 4; swipe += 1) {
    await app.execute('mobile: swipeGesture', { left: 80, top: 600, width: 920, height: 1400, direction: 'down', percent: 0.9 });
  }
  await closeSupportChat(app);
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
  // The field is shown empty first and filled with "Wallet Balance: KWD ..." once the wallet loads.
  let text = '';
  await app.waitUntil(async () => /wallet balance/i.test(text = await balance.getText().catch(() => '')), {
    timeout: 30_000,
    timeoutMsg: 'The wallet balance text did not load',
  }).catch(() => undefined);
  return readKwd(text, label);
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

/**
 * Types the test card into the KNET test gateway at a measured pace and checks what each field shows before Submit:
 * a value that did not land as typed is cleared and typed once more, and a second mismatch stops the test with what
 * the field holds. The pauses add only a few seconds, as the recharge payment timer is short (about 1-2 minutes).
 * The card number is reported masked to its last 4 digits, and the PIN only by its length.
 */
export const enterKnetCard = async (app: AndroidApp, config: AndroidConfig) => {
  const { knetNumber, knetExpiry, knetPin } = config.payment;
  // The KNET test card is used with PIN 1111 (agreed 15 Oct 2026); ANDROID_TEST_KNET_EXPECTED_PIN can name another.
  const expectedPin = process.env.ANDROID_TEST_KNET_EXPECTED_PIN || '1111';
  if (knetPin !== expectedPin) throw new Error(`The configured KNET test PIN is not ${expectedPin}; set ANDROID_TEST_KNET_PIN=${expectedPin} in .env.`);
  const field = (name: string) => app.$(`android=new UiSelector().resourceId("${name}")`);
  const digits = (value: string) => value.replace(/\D/g, '');
  const fill = async (name: string, value: string, label: string, entered: (shown: string) => boolean) => {
    const input = field(name);
    await input.waitForDisplayed({ timeout: 30_000, timeoutMsg: `The KNET page did not show the ${label} field` });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await input.click();
      await app.pause(600);
      if (attempt > 0) await input.clearValue();
      // Some gateway builds take the expiry as MMYY digits and insert the slash themselves.
      await input.setValue(attempt > 0 && name === 'expiryDateInput' ? digits(value) : value);
      await app.pause(800);
      const shown = (await input.getText().catch(() => '')).trim();
      if (entered(shown)) return shown;
    }
    const shown = (await input.getText().catch(() => '')).trim();
    throw new Error(`The KNET ${label} was not entered as typed (the field shows "${name === 'cardPin' ? '*'.repeat(shown.length) : shown}")`);
  };
  const number = await fill('debitNumber', knetNumber, 'card number', (shown) => digits(shown) === digits(knetNumber));
  const expiry = await fill('expiryDateInput', knetExpiry, 'expiry date', (shown) => digits(shown) === digits(knetExpiry));
  // A PIN shown as digits must read exactly the test PIN; a masked PIN (dots) can only be checked by its length.
  const pin = await fill('cardPin', knetPin, 'PIN', (shown) => (/\d/.test(shown) ? shown === knetPin : shown.length === knetPin.length));
  const pinCheck = /\d/.test(pin) ? `PIN ${pin} read back` : `PIN ${knetPin} typed (the field masks it: ${pin.length} characters shown)`;
  await app.hideKeyboard().catch(() => undefined);
  await app.pause(1_000);
  test.info().annotations.push({
    type: 'KNET details',
    description: `card ending ${digits(number).slice(-4)}, expiry ${expiry}, ${pinCheck} - checked before Submit`,
  });
};

/** Restarts the screen recording that is paused while the card is typed (the card stays out of the video). */
export const resumeRecording = async (app: AndroidApp, config: AndroidConfig) => {
  if (config.video === 'off') return;
  await app.startRecordingScreen({ timeLimit: String(config.videoSeconds), bitRate: '1500000', videoSize: '540x1200', forceRestart: true });
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
    await enterKnetCard(app, config);
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
    if (wasRecording) await resumeRecording(app, config);
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
 * Drags the Account list up by about 600 px and holds before lifting the finger. A quick swipe flings the list on, past
 * whole booking cards (about 930 px apart on the Internal builds), which the walk then missed (AND-50, 18 Oct). The drag
 * runs down the left side, clear of the support-chat bubble at the bottom right.
 */
const dragAccountList = async (app: AndroidApp) => {
  await app.performActions([{
    type: 'pointer',
    id: 'finger',
    parameters: { pointerType: 'touch' },
    actions: [
      { type: 'pointerMove', duration: 0, x: 300, y: 1900 },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 150 },
      { type: 'pointerMove', duration: 900, x: 300, y: 1300 },
      { type: 'pause', duration: 500 },
      { type: 'pointerUp', button: 0 },
    ],
  }]);
  await app.releaseActions();
  await app.pause(700);
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
  // The cards arrive after the heading; read too early, the list looked empty and the walk ended with "listed: none"
  // (AND-41, UAT new app 18 Oct). With no upcoming bookings Account says "There are no active bookings." instead.
  const listLoaded = async () => (await app.$$(id('imageView7')).length) > 0 || app.$(id('noHistory')).isDisplayed().catch(() => false);
  await app.waitUntil(listLoaded, { timeout: 20_000 }).catch(() => undefined);
  // Positions of the cards on screen: when it stops changing, the end of the list has been reached.
  const cardsOnScreen = async () => (await app.$$(id('imageView7')).map(async (card) => {
    const { y } = await card.getLocation();
    const { height } = await card.getSize();
    return `${y}+${height}`;
  })).join(',') + (await heading.getLocation().then(({ y }) => y).catch(() => -1));
  // Back from a ticket can rebuild Account at its top; the list is then dragged back to where the walk was.
  let drags = 0;
  const restoreScroll = async (expected: string) => {
    if (await cardsOnScreen() === expected) return;
    await openAccountTop(app);
    await app.waitUntil(listLoaded, { timeout: 20_000 }).catch(() => undefined);
    for (let drag = 0; drag < drags; drag += 1) await dragAccountList(app);
  };
  const ids: string[] = [];
  let previousScreen = '';
  for (let page = 0; page < 40; page += 1) {
    const cardCount = await app.$$(id('imageView7')).length;
    // Held food orders ("Food Order", "74 - In Queue", Prepare Food) are listed among the bookings but open no ticket.
    const foodOrderTops = await app.$$(byText('Food Order')).map(async (label) => (await label.getLocation()).y);
    for (let index = 0; index < cardCount; index += 1) {
      const card = (await app.$$(id('imageView7')))[index];
      if (!card) break;
      const { y } = await card.getLocation();
      const { height } = await card.getSize();
      // Only tap cards fully inside the Account content area (below the header, above the tab bar).
      // A card clipped by the tab bar reports only its visible sliver (e.g. 46 px); tapping that strip opens the
      // support chat on the Internal builds, so wait for the scroll to bring the whole card (~520 px) into view.
      if (y < 283 || y + height > 2253 || height < 300) continue;
      if (foodOrderTops.some((top) => top >= y && top <= y + height)) continue;
      // On the Internal builds a tap made while Account is still settling can land on the support-chat launcher
      // instead of the card; let the screen settle, and if the chat (or anything but the ticket) opens, go back and tap again.
      const ticketId = app.$(id('text_bookin_id_no'));
      await app.pause(1_000);
      const before = await cardsOnScreen();
      await card.click();
      if (!(await ticketId.waitForDisplayed({ timeout: 15_000 }).catch(() => false))) {
        await app.back();
        await app.$(id('recyclerview_booking')).waitForDisplayed({ timeout: 20_000, timeoutMsg: 'Back from the wrong screen did not return to Account' });
        await app.pause(2_000);
        await (await app.$$(id('imageView7')))[index].click();
        await ticketId.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'An upcoming booking card did not open its ticket' });
      }
      const bookingId = (await ticketId.getText()).trim();
      if (bookingId === stopAt) return ids;
      if (!ids.includes(bookingId)) ids.push(bookingId);
      await app.back();
      await app.$(id('recyclerview_booking')).waitForDisplayed({ timeout: 20_000, timeoutMsg: 'Back from the ticket did not return to Account' });
      await app.pause(800);
      await restoreScroll(before);
    }
    const screen = await cardsOnScreen();
    if (screen === previousScreen || !(await app.$(id('recyclerview_booking')).isDisplayed().catch(() => false))) break;
    previousScreen = screen;
    await dragAccountList(app);
    drags += 1;
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
  // The AWS build shows "15 Oct 2026 15:00" in one field; the Internal builds show Date and Time as separate fields,
  // so the time is then the "HH:MM" text on the same row as the date.
  let dateTime = (await text('txt_date')).replace(/\s+/g, ' ');
  if (dateTime && !/\d{1,2}:\d{2}/.test(dateTime)) {
    const dateY = await app.$(id('txt_date')).getLocation().then(({ y }) => y).catch(() => -1);
    for (const time of await app.$$('android=new UiSelector().textMatches("^\\d{1,2}:\\d{2}$")')) {
      if (Math.abs((await time.getLocation()).y - dateY) < 40) { dateTime = `${dateTime} ${(await time.getText()).trim()}`; break; }
    }
  }
  return {
    bookingId: await text('text_bookin_id_no'),
    movie: await text('text_film_house_name'),
    location: await text('text_location_names'),
    dateTime,
    screen: await text('txt_scrrens'),
    category: await text('categoryName'),
    seats: await app.$$(id('seatNumber')).map(async (seat) => (await seat.getText()).trim()),
    hasQrCode: await app.$(id('image_qr_code')).isDisplayed().catch(() => false),
  };
};

/** Cancels a confirmed booking from its ticket ("Cancel Reservation" > "Yes, I'm Sure"). */
export const cancelBooking = async (app: AndroidApp, bookingId: string) => {
  // Walking a long Upcoming list takes minutes, so a ticket that is already open is cancelled from where it is.
  // The confirmation screen right after paying shows the Booking ID too, but has no Cancel Reservation.
  const cancel = app.$(id('textView48'));
  const openTicket = (await app.$(id('text_bookin_id_no')).getText().catch(() => '')).trim();
  if (openTicket !== bookingId || !(await cancel.isDisplayed().catch(() => false))) await openUpcomingTicket(app, bookingId);
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
  // History can take well over 10 s to load when the customer has many bookings.
  await tapPastSupportChat(app, id('view_historys'),
    '//*[@resource-id="com.cinescape:id/recyclerview_booking_history" or @resource-id="com.cinescape:id/noHistory"]',
    'History did not open', 45_000);
  const list = app.$(id('recyclerview_booking_history'));
  const empty = app.$(id('noHistory'));
  await app.waitUntil(async () => (await list.isDisplayed().catch(() => false)) || (await empty.isDisplayed().catch(() => false)), {
    timeout: 45_000,
    timeoutMsg: 'History showed neither entries nor an empty state',
  });
  // Rows differ (a Wallet Recharge has no status), so each title takes the date and status shown in its own row -
  // below it and above the next title - rather than the one at the same position in the list (18 Oct).
  const read = async (name: string) => app.$$(id(name)).map(async (el) => ({ y: (await el.getLocation()).y, text: (await el.getText()).trim() }));
  // The last row can be cut off by the tab bar, with its title on screen but its date and status below the edge (UAT
  // new app, 20 Oct); only rows whose date and status lines (about 120 px below the title's top) are on screen are read.
  const listBottom = await list.getLocation().then(async ({ y }) => y + (await list.getSize()).height).catch(() => Infinity);
  const titles = (await read('text_booking_history_title')).filter((title) => title.y + 120 <= listBottom).sort((a, b) => a.y - b.y);
  const dates = await read('text_booking_history_date');
  const statuses = await read('text_booking_history_time');
  return titles.map((title, index): HistoryEntry => {
    const inRow = (list: { y: number; text: string }[]) =>
      list.find((field) => field.y >= title.y - 40 && field.y < (titles[index + 1]?.y ?? Infinity) - 40)?.text ?? '';
    return { title: title.text, date: inRow(dates), status: inRow(statuses) };
  });
};

/** Taps the History entry at `index` (in screen order, as `bookingHistory` lists them) to expand its details. */
export const expandHistoryEntry = async (app: AndroidApp, index: number) => {
  const rows = await app.$$(id('view_booking_history')).map(async (row) => ({ row, y: (await row.getLocation()).y }));
  const target = rows.sort((a, b) => a.y - b.y)[index];
  if (!target) throw new Error(`History has no entry ${index + 1} on screen to expand`);
  await target.row.click();
};

/**
 * Position in History of the newest booking. Wallet recharges and food-only orders are listed too, and one can sit above
 * the booking a test just made: the customer's wallet is shared with other suites, which recharged it mid-test (20 Oct).
 */
export const newestBookingIndex = (entries: HistoryEntry[]) =>
  Math.max(0, entries.findIndex((entry) => !['Wallet Recharge', 'Food Order'].includes(entry.title)));

/** Expands a History entry (by default the newest booking's position from `newestBookingIndex`) and returns its Booking ID and Track ID. */
export const historyPaymentDetails = async (app: AndroidApp, index = 0) => {
  await expandHistoryEntry(app, index);
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
  // Nothing on Account reports itself as scrollable on the Internal builds, so the list is swiped by hand until a
  // Prepare Food button sits fully on screen (above the tab bar), or the list stops moving.
  const held = app.$(id('food_pickup_btn'));
  let previous = '';
  for (let swipe = 0; swipe < 25; swipe += 1) {
    const top = await held.isDisplayed().catch(() => false) ? (await held.getLocation()).y : -1;
    if (top > 300 && top < 1900) break;
    const screen = (await app.$$(id('txt_date')).map(async (date) => (await date.getLocation()).y)).join(',');
    if (screen === previous) break;
    previous = screen;
    await app.execute('mobile: swipeGesture', { left: 80, top: 1300, width: 920, height: 700, direction: 'up', percent: 0.5 });
    await app.pause(800);
  }
  if (!(await held.isDisplayed().catch(() => false))) return undefined;
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
  // A placeholder ("Poster unavailable" on the Internal builds: black with a grey arrow and caption) is not 90% one
  // colour, but it has only a handful of colours, where any real picture has hundreds.
  return { judged: true, blank: dominantShare >= 0.9 || counts.size < 40, dominantShare, crop };
};
