import { inflateSync } from 'node:zlib';
import { test, expect } from '../src/fixtures';
import { enterAsGuest, hasKioskCustomer, openArea, signInAsUser } from '../src/android-navigation';

/** Decodes an 8-bit RGB/RGBA, non-interlaced PNG (the format Appium screenshots use). */
const decodePng = (png: Buffer) => {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = chunk[9] === 6 ? 4 : chunk[9] === 2 ? 3 : 0;
      if (chunk[8] !== 8 || !channels || chunk[12] !== 0) throw new Error('Unsupported PNG format for the colour check.');
    } else if (type === 'IDAT') {
      data.push(chunk);
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      const paeth = () => {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      };
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter] ?? 0;
      line[x] = (line[x] + predictor) & 0xff;
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return { width, height, channels, pixels };
};

type Area = { x: number; y: number; width: number; height: number };

/** Average RGB of a PNG, optionally only inside one area of it. */
const averageColour = (png: Buffer, area?: Area) => {
  const image = decodePng(png);
  const { x = 0, y = 0, width = image.width, height = image.height } = area ?? {};
  const totals = [0, 0, 0];
  let count = 0;
  for (let row = Math.max(0, y); row < Math.min(image.height, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(image.width, x + width); column += 1) {
      const index = (row * image.width + column) * image.channels;
      totals[0] += image.pixels[index];
      totals[1] += image.pixels[index + 1];
      totals[2] += image.pixels[index + 2];
      count += 1;
    }
  }
  return { r: totals[0] / count, g: totals[1] / count, b: totals[2] / count };
};

/** Number of clearly red pixels (validation text) inside an area of a screenshot. */
const redPixels = (png: Buffer, area: Area) => {
  const image = decodePng(png);
  let count = 0;
  for (let row = Math.max(0, area.y); row < Math.min(image.height, area.y + area.height); row += 1) {
    for (let column = Math.max(0, area.x); column < Math.min(image.width, area.x + area.width); column += 1) {
      const index = (row * image.width + column) * image.channels;
      if (image.pixels[index] > 150 && image.pixels[index + 1] < 90 && image.pixels[index + 2] < 90) count += 1;
    }
  }
  return count;
};

const byText = (text: string) => `android=new UiSelector().text("${text}")`;

test('AND-52 Support chat with the AI agent', async ({ app, snap, androidConfig }) => {
  test.setTimeout(300_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-52 needs the configured Kiosk UAT customer (username, password and OTP); the chat icon is only shown to signed-in users.');
  }
  const chatIcon = app.$('id=com.cinescape:id/chatIcon');

  // 1. A guest's Account tab asks for sign-in and has no support chat.
  await enterAsGuest(app);
  await openArea(app, 'account');
  const signIn = app.$('id=com.cinescape:id/btn_sign_in');
  await signIn.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Guest Account did not ask for sign-in' });
  expect(await chatIcon.isDisplayed().catch(() => false), 'Guests are not offered the support chat').toBe(false);
  await snap('AND-52: guest Account has no support chat icon');

  // 2. After signing in, Account shows the red headset chat button.
  // The guest Account tab usually embeds the sign-in form; tapping Sign in there would submit it empty.
  if (!(await app.$('id=com.cinescape:id/enterUsername').isDisplayed().catch(() => false))) await signIn.click();
  await signInAsUser(app, androidConfig, 'kiosk');
  await openArea(app, 'account');
  await app.$('id=com.cinescape:id/text_user_account_name').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'The signed-in Account screen did not open',
  });
  await chatIcon.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Signed-in Account did not show the support chat (headset) icon' });
  expect(await chatIcon.getAttribute('clickable'), 'The headset icon can be tapped').toBe('true');
  const { r, g, b } = averageColour(Buffer.from(await app.takeElementScreenshot(await chatIcon.elementId), 'base64'));
  expect(r, `The headset icon has a red background (average RGB ${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`)
    .toBeGreaterThan(Math.max(g, b) + 60);
  await snap('AND-52: red headset chat icon on Account');

  // 3. The icon opens the in-app "Chat with us" AI agent with its consent notice.
  await chatIcon.click();
  const title = app.$('id=com.cinescape:id/tvTitle');
  await title.waitForDisplayed({ timeout: 20_000, timeoutMsg: 'The headset icon did not open the chat screen' });
  expect((await title.getText()).trim()).toBe('Chat with us');
  expect(await app.$('id=com.cinescape:id/webView1').isDisplayed(), 'The chat agent is loaded in the chat screen').toBe(true);
  const toEnglish = app.$(byText('التبديل إلى English'));
  const toArabic = app.$(byText('Switch to العربية'));
  await app.waitUntil(async () => (await toEnglish.isDisplayed().catch(() => false)) || (await toArabic.isDisplayed().catch(() => false)), {
    timeout: 30_000,
    timeoutMsg: 'The AI agent chat widget did not load its language switch',
  });
  if (await toEnglish.isDisplayed().catch(() => false)) {
    await snap('AND-52: chat agent opened in Arabic');
    await toEnglish.click();
  }
  await toArabic.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The chat agent did not switch to English' });

  const consentTexts = [
    'Welcome to Cinescape',
    'This assistant helps you find films, showtimes and food, and answers your questions.',
    'AI suggestions may occasionally be incorrect. Please review details before purchasing.',
    'Your interactions may be used to improve recommendations and your experience.',
    'Terms of Use',
    'Privacy Policy',
  ];
  for (const text of consentTexts) {
    await app.$(byText(text)).waitForDisplayed({ timeout: 15_000, timeoutMsg: `The AI consent notice did not show "${text}"` });
  }
  expect(await app.getPageSource(), 'The chat agent shows its provider').toMatch(/text="Powered by"[\s\S]*text="Pair"/i);
  await snap('AND-52: AI agent consent notice in English');

  // 4. Accepting opens the pre-chat form; the required fields are validated.
  await app.$(byText('Agree & Continue')).click();
  const email = app.$('android=new UiSelector().className("android.widget.EditText").instance(0)');
  await email.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Accepting the notice did not open the chat form' });
  for (const label of ['Share your queries or comments here.', 'Email Id*', 'Full name', 'Phone number*', 'KW +965', 'Message*']) {
    expect(await app.$(byText(label)).isDisplayed().catch(() => false), `The chat form shows "${label}"`).toBe(true);
  }
  expect(await app.$$('android.widget.EditText').length, 'Email, name, mobile and message inputs are offered').toBe(4);
  const startChat = app.$(byText('Start Chat'));
  // The red validation messages are drawn by the web form but not exposed to UiAutomator, so they are
  // checked as red text in the band just below the Email and Phone inputs.
  const formInputs = await app.$$('android.widget.EditText');
  const errorBandBelow = async (input: { getLocation(): Promise<{ x: number; y: number }>; getSize(): Promise<{ width: number; height: number }> }) => {
    const { x, y } = await input.getLocation();
    const { width, height } = await input.getSize();
    return { x: Math.round(x), y: Math.round(y + height), width: Math.round(width), height: 80 };
  };
  const emailErrorBand = await errorBandBelow(formInputs[0]);
  const phoneErrorBand = await errorBandBelow(formInputs[2]);
  const beforeSubmit = Buffer.from(await app.takeScreenshot(), 'base64');
  expect(redPixels(beforeSubmit, emailErrorBand), 'No email error is shown before submitting').toBeLessThan(50);
  await startChat.click();
  await app.pause(1_500);
  const afterSubmit = Buffer.from(await app.takeScreenshot(), 'base64');
  expect(redPixels(afterSubmit, emailErrorBand), 'An empty form shows "Email Id is required"').toBeGreaterThan(200);
  // The email error pushes the later fields down, so the phone band is measured from its new position.
  const phoneBandAfter = await errorBandBelow((await app.$$('android.widget.EditText'))[2]);
  expect(phoneBandAfter.y, 'The email error moves the rest of the form down').toBeGreaterThan(phoneErrorBand.y);
  expect(redPixels(afterSubmit, phoneBandAfter), 'An empty form shows "Phone number is required"').toBeGreaterThan(200);
  await app.hideKeyboard().catch(() => undefined);
  expect(await app.$(byText('AI Assistant Avatar')).isDisplayed().catch(() => false), 'An invalid form does not start a chat').toBe(false);
  expect(await title.isDisplayed(), 'An invalid form stays on the chat form').toBe(true);
  await snap('AND-52: required-field errors on the chat form');

  // 5. Start a conversation with a simple "hi" (test contact details) and check the AI agent answers it.
  const inputs = await app.$$('android.widget.EditText');
  await inputs[0].setValue(androidConfig.newUser.email);
  await inputs[1].setValue('Auto Tester');
  // The widget only accepts Kuwaiti mobile prefixes it recognises; 50xxxxxx is accepted.
  await inputs[2].setValue(`50${Date.now().toString().slice(-6)}`);
  await inputs[3].setValue('hi');
  await app.hideKeyboard().catch(() => undefined);
  await snap('AND-52: chat form filled with test details and "hi"');
  await startChat.click();
  await startChat.waitForDisplayed({
    reverse: true,
    timeout: 30_000,
    timeoutMsg: `Start Chat did not open a conversation: ${[...(await app.getPageSource()).matchAll(/text="([^"]*valid[^"]*)"/gi)].map((m) => m[1]).join('; ')}`,
  });
  expect(await app.$$('android.widget.EditText').length, 'The pre-chat form closed').toBeLessThan(4);
  await app.$(byText('Cinescape')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The conversation header did not show Cinescape' });
  await app.$(byText('hi')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The conversation did not show the sent "hi" message' });
  await app.$(byText('AI Assistant Avatar')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The AI agent did not reply to "hi"' });
  // The reply is the text between the agent avatar and its feedback buttons.
  let reply = '';
  await app.waitUntil(async () => {
    const texts = [...(await app.getPageSource()).matchAll(/text="([^"]+)"/g)].map((match) => match[1]);
    const start = texts.lastIndexOf('AI Assistant Avatar');
    const end = texts.indexOf('Thumbs up', start);
    reply = start >= 0 && end > start ? texts.slice(start + 1, end).join(' ').trim() : '';
    return reply.length > 0;
  }, { timeout: 60_000, timeoutMsg: 'The AI agent reply had no text before its feedback buttons' });
  expect(reply, 'The AI agent greets the customer').toMatch(/welcome|hello|hi|help/i);
  for (const feedback of ['Thumbs up', 'Thumbs down']) {
    expect(await app.$(byText(feedback)).isDisplayed(), `The reply offers "${feedback}" feedback`).toBe(true);
  }
  await app.hideKeyboard().catch(() => undefined);
  await snap(`AND-52: AI agent replied "${reply.replace(/&#\d+;/g, '').trim()}"`);

  // 6. Back closes the chat and returns to Account.
  await app.$('id=com.cinescape:id/btnBack').click();
  await chatIcon.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Closing the chat did not return to Account' });
  expect(await app.$('id=com.cinescape:id/text_user_account_name').isDisplayed()).toBe(true);
  await snap('AND-52: chat closed, back on Account');
});
