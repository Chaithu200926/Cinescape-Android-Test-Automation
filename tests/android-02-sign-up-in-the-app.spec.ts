import { expect, test } from '../src/fixtures';
import type { AndroidApp } from '../src/android-navigation';

const registrationFieldsAtTop = [
  ['enter_emails', 'Email'],
  ['enter_first_names', 'First name'],
  ['enter_last_names', 'Last name'],
  ['enter_passwords', 'Password'],
  ['enter_confirm_passwords', 'Confirm Password'],
  ['editTextPhone', 'Mobile number'],
] as const;

const registrationFieldsAtBottom = [
  ['enter_date_births', 'Date of Birth'],
  ['male', 'Male gender option'],
  ['female', 'Female gender option'],
] as const;

const selectDateOfBirth = async (app: AndroidApp, value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('ANDROID_TEST_NEW_USER_DATE_OF_BIRTH must be a valid date in YYYY-MM-DD format.');
  }

  await app.$('id=com.cinescape:id/enter_date_births').click();
  await app.$('id=android:id/date_picker_header_year').click();
  const yearPicker = app.$('id=android:id/date_picker_year_picker');
  const yearPickerId = await yearPicker.elementId;
  const year = app.$(`android=new UiSelector().text("${date.getUTCFullYear()}")`);
  let yearDisplayed = await year.isDisplayed();
  let visibleYears = await app.$$('id=android:id/text1').map((item) => item.getText());
  for (let attempt = 0; !yearDisplayed && attempt < 40; attempt += 1) {
    const previousYears = visibleYears;
    await app.execute('mobile: scrollGesture', {
      elementId: yearPickerId,
      direction: 'up',
      percent: 0.55,
    });
    visibleYears = await app.$$('id=android:id/text1').map((item) => item.getText());
    yearDisplayed = await year.isDisplayed();
    if (!yearDisplayed && visibleYears.join(',') === previousYears.join(',')) break;
  }
  if (!yearDisplayed) {
    throw new Error(`Year ${date.getUTCFullYear()} is not available in the DOB year picker. Visible years: ${visibleYears.join(', ')}.`);
  }
  await year.click();

  const currentDate = await app.$('id=android:id/date_picker_header_date').getText();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonth = monthNames.findIndex((month) => currentDate.includes(month));
  if (currentMonth < 0) throw new Error(`Could not determine the displayed month in the date picker: "${currentDate}".`);

  const targetMonth = date.getUTCMonth();
  const monthsBack = (currentMonth - targetMonth + 12) % 12;
  const monthsForward = (targetMonth - currentMonth + 12) % 12;
  const direction = monthsBack <= monthsForward ? 'prev' : 'next';
  const steps = Math.min(monthsBack, monthsForward);
  for (let month = 0; month < steps; month += 1) {
    await app.$(`id=android:id/${direction}`).click();
  }

  await app.$(`android=new UiSelector().text("${date.getUTCDate()}")`).click();
  await app.$('id=android:id/button1').click();
  expect(await app.$('id=com.cinescape:id/enter_date_births').getText()).not.toBe('Date of Birth');
};

test('AND-02 Sign up in the app', async ({ app, snap, androidConfig }) => {
  const signIn = app.$('id=com.cinescape:id/btn_sign_in');
  await signIn.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The Sign in screen did not appear' });
  expect(await app.getCurrentPackage()).toBe(androidConfig.appPackage);
  await snap('AND-02: sign-in screen');

  await app.$('id=com.cinescape:id/textView108').click();
  const signup = app.$('id=com.cinescape:id/signupUi');
  await signup.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The registration form did not open' });
  await snap('AND-02: registration form');

  for (const [id, label] of registrationFieldsAtTop) {
    expect(await app.$(`id=com.cinescape:id/${id}`).isDisplayed(), `${label} control is available`)
      .toBe(true);
  }

  await app.execute('mobile: swipeGesture', {
    left: 80,
    top: 900,
    width: 920,
    height: 1300,
    direction: 'up',
    percent: 0.75,
  });
  for (const [id, label] of registrationFieldsAtBottom) {
    expect(await app.$(`id=com.cinescape:id/${id}`).isDisplayed(), `${label} control is available`)
      .toBe(true);
  }
  expect(await app.$('id=com.cinescape:id/image_receive_switcher_email').isDisplayed(), 'Promotional email preference is available')
    .toBe(true);
  expect(await app.$('id=com.cinescape:id/imageMoNotification').isDisplayed(), 'Mobile notification preference is available')
    .toBe(true);
  expect(await app.$('id=com.cinescape:id/imageView5').isDisplayed(), 'Reservation notification preference is available')
    .toBe(true);
  expect(await app.$('id=com.cinescape:id/text_terms_conditions').isDisplayed(), 'Terms and conditions are available')
    .toBe(true);
  expect(await app.$('id=com.cinescape:id/signup_btn').isDisplayed(), 'Registration submit button is available')
    .toBe(true);

  await app.$('id=com.cinescape:id/signup_btn').click();
  const validationMessage = app.$('id=com.cinescape:id/subtitle');
  await validationMessage.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'Submitting an empty registration form did not show validation',
  });
  expect(await validationMessage.getText()).toBe('Please enter email');
  await app.$('id=com.cinescape:id/positive_btn').click();
  await signup.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'The registration form closed after dismissing validation' });
  await snap('AND-02: required email validation');

  const {
    email,
    firstName,
    lastName,
    password,
    mobile,
    dateOfBirth: dateOfBirthValue,
    gender,
  } = androidConfig.newUser;
  if (gender !== 'male' && gender !== 'female') {
    throw new Error('ANDROID_TEST_NEW_USER_GENDER must be either "male" or "female".');
  }

  const dateOfBirth = new Date(`${dateOfBirthValue}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirthValue)
    || Number.isNaN(dateOfBirth.getTime())
    || dateOfBirth.toISOString().slice(0, 10) !== dateOfBirthValue
  ) {
    throw new Error('ANDROID_TEST_NEW_USER_DATE_OF_BIRTH must be a valid date in YYYY-MM-DD format.');
  }

  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  test.skip(!wasRecording, 'Registration data was not entered because the screen recording could not be paused safely.');

  const otpField = app.$('id=com.cinescape:id/textView146');
  const mobileOtpField = app.$('id=com.cinescape:id/textView149');
  let sensitiveDataEntered = false;
  try {
    sensitiveDataEntered = true;
    await app.execute('mobile: swipeGesture', {
      left: 80,
      top: 900,
      width: 920,
      height: 1300,
      direction: 'down',
      percent: 0.75,
    });
    await app.$('id=com.cinescape:id/enter_emails').setValue(email);
    await app.$('id=com.cinescape:id/enter_first_names').setValue(firstName);
    await app.$('id=com.cinescape:id/enter_last_names').setValue(lastName);
    await app.$('id=com.cinescape:id/enter_passwords').setValue(password);
    await app.$('id=com.cinescape:id/enter_confirm_passwords').setValue(password);
    await app.hideKeyboard();
    await app.execute('mobile: swipeGesture', {
      left: 80,
      top: 900,
      width: 920,
      height: 1300,
      direction: 'up',
      percent: 0.75,
    });
    await app.$('id=com.cinescape:id/editTextPhone').setValue(mobile);
    await app.hideKeyboard();
    await selectDateOfBirth(app, dateOfBirthValue);
    await app.$(`id=com.cinescape:id/${gender}`).click();

    await app.execute('mobile: swipeGesture', {
      left: 80,
      top: 900,
      width: 920,
      height: 1300,
      direction: 'up',
      percent: 0.75,
    });
    await app.$('id=com.cinescape:id/signup_btn').click();
    await otpField.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: 'Registration did not advance to the OTP verification screen',
    });
    await otpField.setValue(androidConfig.newUserOtp);
    await mobileOtpField.setValue(androidConfig.newUserOtp);
    await app.$('id=com.cinescape:id/textView150').click();

    const home = app.$('id=com.cinescape:id/homeUi');
    const personalization = app.$('id=com.cinescape:id/btn_get_personal');
    await app.waitUntil(async () => await home.isDisplayed() || await personalization.isDisplayed(), {
      timeout: 45_000,
      timeoutMsg: 'The new account did not reach the home screen or personalization onboarding after OTP verification',
    });
    await app.startRecordingScreen({
      timeLimit: String(androidConfig.videoSeconds),
      bitRate: '4000000',
      forceRestart: true,
    });
    await snap(
      await home.isDisplayed()
        ? 'AND-02: new account verified and signed in'
        : 'AND-02: new account verified; personalization onboarding',
    );
  } catch (error) {
    if (sensitiveDataEntered) {
      const signupIsVisible = await signup.isDisplayed().catch(() => false);
      if (signupIsVisible) {
        for (const [id] of registrationFieldsAtTop) {
          await app.$(`id=com.cinescape:id/${id}`).clearValue();
        }
        await app.$('id=com.cinescape:id/editTextPhone').clearValue();
        await app.$('id=com.cinescape:id/enter_date_births').clearValue();
      }
      if (await otpField.isDisplayed().catch(() => false)) await otpField.clearValue();
      if (await mobileOtpField.isDisplayed().catch(() => false)) await mobileOtpField.clearValue();
    }
    throw error;
  }
});
