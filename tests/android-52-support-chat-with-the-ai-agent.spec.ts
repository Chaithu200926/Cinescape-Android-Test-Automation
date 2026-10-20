import { test, expect } from '../src/fixtures';
import { type AndroidApp, closeSupportChat, enterAsGuest, hasKioskCustomer, openArea, signInAsUser, supportChatIsOpen } from '../src/android-navigation';

// The Internal builds replaced the red headset icon and its "Chat with us" screen with a web chat on Account
// ("Cinescape chat", the Pair AI agent, as on the website - WEB-48): a "Chat with us!" bubble opens a panel in Arabic
// first, with a consent notice, a pre-chat form and then the conversation (UAT new app, 20 Oct 2026).
const button = (text: string) => `//android.widget.Button[@text="${text}"]`;
const textIs = (text: string) => `//*[@text="${text}" or @content-desc="${text}"]`;
const chatBubble = button('Chat with us!');

/** The y position of a form label, to see the red required-field messages (drawn, but not in the screen tree) push it down. */
const labelTop = async (app: AndroidApp, label: string) => (await app.$(textIs(label)).getLocation()).y;

/** Texts shown in the open chat, in screen order. */
const chatTexts = async (app: AndroidApp) => [...(await app.getPageSource()).matchAll(/text="([^"]+)"/g)]
  .map((match) => match[1].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim())
  .filter(Boolean);

test('AND-52 Support chat with the AI agent', async ({ app, snap, androidConfig }) => {
  test.setTimeout(360_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-52 needs the configured Kiosk UAT customer (username, password and OTP); the chat is only shown to signed-in users.');
  }

  // 1. A guest's Account tab asks for sign-in and has no support chat.
  await enterAsGuest(app);
  await openArea(app, 'account');
  const signIn = app.$('id=com.cinescape:id/btn_sign_in');
  await signIn.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Guest Account did not ask for sign-in' });
  await app.pause(5_000);
  expect(await app.$(chatBubble).isDisplayed().catch(() => false), 'Guests are not offered the support chat').toBe(false);
  expect(await supportChatIsOpen(app), 'No support chat opens for a guest').toBe(false);
  await snap('AND-52: guest Account has no support chat');

  // 2. After signing in, Account offers the "Chat with us!" bubble.
  // The guest Account tab usually embeds the sign-in form; tapping Sign in there would submit it empty.
  if (!(await app.$('id=com.cinescape:id/enterUsername').isDisplayed().catch(() => false))) await signIn.click();
  await signInAsUser(app, androidConfig, 'kiosk');
  await openArea(app, 'account');
  const accountName = app.$('id=com.cinescape:id/text_user_account_name');
  await accountName.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The signed-in Account screen did not open' });
  // The chat loads a few seconds after Account and sometimes opens over it by itself.
  await app.waitUntil(async () => (await app.$(chatBubble).isDisplayed().catch(() => false)) || supportChatIsOpen(app), {
    timeout: 45_000,
    timeoutMsg: 'Signed-in Account did not load the support chat ("Chat with us!")',
  });
  if (await supportChatIsOpen(app)) {
    test.info().annotations.push({ type: 'finding', description: 'The support chat opened over the Account screen by itself, without a tap on "Chat with us!".' });
    await snap('AND-52: support chat opened by itself over Account');
    await closeSupportChat(app);
  }
  await app.$(chatBubble).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Signed-in Account did not show the "Chat with us!" bubble' });
  expect(await app.$(chatBubble).getAttribute('clickable'), 'The chat bubble can be tapped').toBe('true');
  await snap('AND-52: "Chat with us!" bubble on Account');

  // 3. The bubble opens the AI agent with its consent notice, Arabic first; it switches to English.
  await app.$(chatBubble).click();
  const toEnglish = app.$(button('التبديل إلى English'));
  const toArabic = app.$(button('Switch to العربية'));
  await app.waitUntil(async () => (await toEnglish.isDisplayed().catch(() => false)) || toArabic.isDisplayed().catch(() => false), {
    timeout: 30_000,
    timeoutMsg: 'The chat bubble did not open the AI agent with its language switch',
  });
  expect(await supportChatIsOpen(app), 'The chat shows its "Powered by" footer').toBe(true);
  expect(await app.$(textIs('Pair')).isDisplayed().catch(() => false), 'The chat names its provider, Pair').toBe(true);
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
    await app.$(textIs(text)).waitForDisplayed({ timeout: 15_000, timeoutMsg: `The AI consent notice did not show "${text}"` });
  }
  await snap('AND-52: AI agent consent notice in English');

  // 4. Accepting opens the pre-chat form; the required fields are validated.
  await app.$(button('Agree & Continue')).click();
  const startChat = app.$(button('Start Chat'));
  await startChat.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Accepting the notice did not open the chat form' });
  for (const label of ['Share your queries or comments here.', 'Email Id*', 'Full name', 'Phone number*', 'Message*']) {
    expect(await app.$(textIs(label)).isDisplayed().catch(() => false), `The chat form shows "${label}"`).toBe(true);
  }
  expect(await app.$(button('KW +965')).isDisplayed().catch(() => false), 'The phone number has the Kuwait +965 prefix').toBe(true);
  expect(await app.$$('android.widget.EditText').length, 'Email, name, mobile and message inputs are offered').toBe(4);
  const before = { name: await labelTop(app, 'Full name'), phone: await labelTop(app, 'Phone number*'), message: await labelTop(app, 'Message*') };
  await startChat.click();
  await app.pause(1_500);
  await app.hideKeyboard().catch(() => undefined);
  const after = { name: await labelTop(app, 'Full name'), phone: await labelTop(app, 'Phone number*'), message: await labelTop(app, 'Message*') };
  // "Email Id is required" sits between Email and Full name; "Phone number is required" between Phone and Message.
  expect(after.name - before.name, 'An empty form shows an error under Email Id').toBeGreaterThan(30);
  expect((after.message - after.phone) - (before.message - before.phone), 'An empty form shows an error under Phone number').toBeGreaterThan(30);
  expect(await app.$$('android.widget.EditText').length, 'An invalid form stays on the chat form').toBe(4);
  expect(await app.$(button('Send message')).isDisplayed().catch(() => false), 'An invalid form does not start a chat').toBe(false);
  await snap('AND-52: required-field errors on the chat form');

  // 5. Start a conversation with a simple "hi" (test contact details) and check the AI agent answers it.
  // The web form takes typed keys; a value set in one go is ignored by the widget (as on the website, WEB-48).
  const type = async (index: number, value: string) => {
    await (await app.$$('android.widget.EditText'))[index].click();
    await app.keys([...value]);
  };
  await type(0, androidConfig.newUser.email);
  await type(1, 'Auto Tester');
  // The widget only accepts Kuwaiti mobile prefixes it recognises; 50xxxxxx is accepted.
  await type(2, `50${Date.now().toString().slice(-6)}`);
  await type(3, 'hi');
  await app.hideKeyboard().catch(() => undefined);
  await snap('AND-52: chat form filled with test details and "hi"');
  await startChat.click();
  await app.$(button('Send message')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Start Chat did not open a conversation' });
  expect(await app.$(textIs('Email Id*')).isDisplayed().catch(() => false), 'The pre-chat form closed').toBe(false);
  await app.$(textIs('Cinescape')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The conversation header did not show Cinescape' });
  await app.$(textIs('hi')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The conversation did not show the sent "hi" message' });
  // The reply is the text after the sent "hi" and before the message box; "Getting ready" shows while the agent starts.
  let reply = '';
  await app.waitUntil(async () => {
    const texts = await chatTexts(app);
    const start = texts.lastIndexOf('hi');
    const end = texts.indexOf('Attach file', start);
    reply = start >= 0 ? texts.slice(start + 1, end > start ? end : undefined)
      .filter((text) => !/^(getting ready|widget avatar|ai assistant avatar|thumbs up|thumbs down|powered by|pair)$/i.test(text)).join(' ').trim() : '';
    return reply.length > 0;
  }, { timeout: 120_000, interval: 3_000, timeoutMsg: 'The AI agent did not reply to "hi"' });
  expect(reply, 'The AI agent greets the customer').toMatch(/welcome|hello|hi|help/i);
  // The reply shows thumbs up / down icons; they are checked by their labels when the widget exposes them.
  const feedback = (await chatTexts(app)).filter((text) => /^thumbs (up|down)$/i.test(text));
  if (feedback.length < 2) {
    test.info().annotations.push({ type: 'note', description: `The reply's feedback buttons are not named in the screen tree (found: ${feedback.join(', ') || 'none'}).` });
  }
  await snap(`AND-52: AI agent replied "${reply.slice(0, 80)}"`);
  test.info().annotations.push({ type: 'agent reply', description: reply.slice(0, 200) });

  // 6. Close ends the chat panel and returns to Account, with the bubble offered again.
  await app.$(button('Close')).click();
  await app.$(chatBubble).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Closing the chat did not return to Account' });
  expect(await supportChatIsOpen(app), 'The chat panel is closed').toBe(false);
  expect(await accountName.isDisplayed()).toBe(true);
  await snap('AND-52: chat closed, back on Account');
});
