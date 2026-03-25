const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── CRM ─────────────────────────────────────────────────────
const CRM_FILE = path.join(__dirname, 'customers.json');

function loadCRM() {
  if (!fs.existsSync(CRM_FILE)) fs.writeFileSync(CRM_FILE, '{}');
  try { return JSON.parse(fs.readFileSync(CRM_FILE, 'utf8')); } catch(e) { return {}; }
}

function saveCRM(data) {
  fs.writeFileSync(CRM_FILE, JSON.stringify(data, null, 2));
}

function updateCustomer(phone, fields) {
  const crm = loadCRM();
  const cleanPhone = phone.replace('@c.us', '').replace('972', '0');
  if (!crm[cleanPhone]) crm[cleanPhone] = { phone: cleanPhone, firstContact: new Date().toISOString(), visits: [] };
  Object.assign(crm[cleanPhone], fields, { lastSeen: new Date().toISOString() });
  saveCRM(crm);
}

function addVisit(phone, service) {
  const crm = loadCRM();
  const cleanPhone = phone.replace('@c.us', '').replace('972', '0');
  if (!crm[cleanPhone]) crm[cleanPhone] = { phone: cleanPhone, firstContact: new Date().toISOString(), visits: [] };
  crm[cleanPhone].visits = crm[cleanPhone].visits || [];
  crm[cleanPhone].visits.push({ service, date: new Date().toISOString() });
  crm[cleanPhone].lastService = service;
  crm[cleanPhone].lastSeen = new Date().toISOString();
  saveCRM(crm);
}

// ── שרת CRM — נגיש מכל מקום ────────────────────────────────
const CRM_HTML = path.join(__dirname, 'crm.html');
const CRM_PASS = process.env.CRM_PASSWORD || 'juliet2026';
let currentQR = null; // שמירת ה-QR הנוכחי

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // דף QR לסריקה
  if (url.pathname === '/qr') {
    if (currentQR) {
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(currentQR);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
        <h2 style="color:#c8a84b;font-family:Arial">💎 סרקי עם WhatsApp</h2>
        <img src="${qrUrl}" style="width:300px;height:300px;border:4px solid #c8a84b;border-radius:12px"/>
        <p style="color:#888;font-family:Arial;margin-top:16px">הגדרות → מכשירים מקושרים → קשרי מכשיר</p>
        <script>setTimeout(()=>location.reload(),30000)</script>
      </body></html>`);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="background:#000;color:#c8a84b;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh"><h2>✅ הבוט כבר מחובר! אין צורך ב-QR</h2></body></html>');
    }
    return;
  }

  // דף CRM — עם סיסמה
  if (url.pathname === '/crm') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html dir="rtl"><body style="font-family:Arial;background:#0a0a0a;color:#c8a84b;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column">
        <h2>💎 Juliet CRM</h2>
        <form method="get" action="/crm">
          <input name="pass" type="password" placeholder="סיסמה" style="padding:10px;margin:10px;border-radius:6px;border:1px solid #c8a84b;background:#111;color:#fff;font-size:16px"/>
          <button type="submit" style="padding:10px 20px;background:#c8a84b;border:none;border-radius:6px;cursor:pointer;font-size:16px">כניסה</button>
        </form>
      </body></html>`);
      return;
    }
    if (fs.existsSync(CRM_HTML)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(CRM_HTML));
    } else {
      res.writeHead(404); res.end('CRM not found');
    }
    return;
  }

  // נתוני לקוחות JSON
  if (url.pathname === '/customers.json') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    const crm = loadCRM();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(crm));
    return;
  }

  // בדיקת חיים
  res.writeHead(200);
  res.end('Juliet Bot is running 💎');
}).listen(process.env.PORT || 3000);

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'juliet-menu-bot' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

// ── State ──────────────────────────────────────────────────
const userState = {};

// ── תפריטים ───────────────────────────────────────────────
const MAIN_MENU = `💎 *שלום! אני ג'וליאט* 💎

במה אוכל לעזור לך היום?

1️⃣ שירותי AI ועיצוב דיגיטלי
2️⃣ Juliet Beauty — טיפולי שיער
3️⃣ שאלות נפוצות (FAQ)
4️⃣ פנייה אישית לג'וליאט

✍️ כתבי מספר בין 1-4`;

const AI_MENU = `🤖 *שירותי JULIET.AI* 💎

מה מעניין אותך?

1️⃣ עיצוב גרפי + לוגו
2️⃣ וידאו ורילס לעסק
3️⃣ ניהול שיווק דיגיטלי
4️⃣ חבילות מחיר ופרטים
5️⃣ חזרה לתפריט ראשי`;

const BEAUTY_MENU = `💆‍♀️ *Juliet Beauty Boutique* 💎

מה מעניין אותך?

1️⃣ החלקות אורגניות
2️⃣ תוספות שיער
3️⃣ צבע והייליטס
4️⃣ קטלוג שירותים ומחירים
5️⃣ חזרה לתפריט ראשי`;

const FAQ_MENU = `❓ *שאלות נפוצות — Juliet Beauty*

בחרי מספר:

1️⃣ כמה עולה החלקה אורגנית?
2️⃣ כמה זמן מחזיק הטיפול?
3️⃣ האם צריך שמפו ללא סולפט אחרי OXO?
4️⃣ כמה עולות תוספות שיער?
5️⃣ שאלה אחרת — דברי עם ג'וליאט
6️⃣ חזרה לתפריט ראשי`;

const CATALOG_MESSAGE = `✨ *Juliet Beauty Boutique* ✨

💆‍♀️ *החלקות אורגניות* — ללא פורמלדהיד
   ELITE | VELLUTO | OXO ORGANIC
   מאושר משרד הבריאות ו-FDA

💇‍♀️ *תוספות שיער* — 6 שיטות שונות
   קראטין | צמידים | קליפסים ועוד

🎨 *צבע ושיער*
   הייליטס | בלייץ' | אומברה

🤖 *שירותי AI ועיצוב* — JULIET.AI
   גרפיקה | וידאו | שיווק דיגיטלי

📲 לכל הפרטים:
https://juliet-beauty-boutique.netlify.app/

נשמח לראות אותך! 💎`;

const FAQ_ANSWERS = {
  '1': `💰 *מחירי החלקה אורגנית:*

• *חידוש שורשים* (עד 12 ס"מ) — *850 ₪*
• *החלקה מלאה* — המחיר תלוי באורך ועובי השיער

📸 שלחי תמונה של השיער שלך ואשלח לך מחיר מותאם אישית!

✅ ללא פורמלדהיד
✅ מאושר משרד הבריאות ו-FDA`,

  '2': `⏳ *כמה זמן מחזיק הטיפול?*

✨ *ההחלקה היא לצמיתות!*
מה שהוחלק — נשאר חלק לתמיד 💎

🔄 צריך רק לחדש את השורשים החדשים שצומחים
⏱ חידוש שורשים — בערך כל *6-8 חודשים*

כלומר: משלמת פעם אחת על ההחלקה המלאה, ואחר כך רק על השורשים 😊`,

  '3': `🧴 *שמפו אחרי OXO — האמת:*

❌ *לא צריך* שמפו ללא סולפט!

✅ אפשר לשחות מיד אחרי הטיפול
✅ אפשר לצבוע מיד אחרי הטיפול
✅ אין הגבלות מיוחדות

זה אחד היתרונות הגדולים של OXO ORGANIC 💎`,

  '4': `💇‍♀️ *מחירי תוספות שיער:*

*🔗 שיטת קראטין (הדבקה):*
• *22 ₪ לגרם*

*📿 צמידי שיער:*
• *2,500 ₪ ל-100 גרם*

📸 לא בטוחה כמה גרם את צריכה?
שלחי תמונה של השיער שלך ואעזור לך 😊`,

  '5': `💬 *שאלה אחרת?*

ג'וליאט תחזור אליך אישית בהקדם! 🙏

📸 אינסטגרם: @juliet_beauty_boutique
🌐 אתר: https://juliet-beauty-boutique.netlify.app/`
};

const AI_ANSWERS = {
  '1': `🎨 *עיצוב גרפי + לוגו — JULIET.AI*

✅ לוגו מקצועי לעסק
✅ עיצוב פוסטים לאינסטגרם ו-TikTok
✅ בנר, כרטיס ביקור, מיתוג מלא

📲 לפרטים ומחירים — שלחי "מחירים"
או צרי קשר ישירות עם ג'וליאט 💎`,

  '2': `🎬 *וידאו ורילס לעסק — JULIET.AI*

✅ רילס מקצועיים לאינסטגרם ו-TikTok
✅ וידאו פרסומי לעסק
✅ מוסיקה, עריכה ואפקטים AI

📲 לפרטים ומחירים — שלחי "מחירים"
או צרי קשר ישירות עם ג'וליאט 💎`,

  '3': `📊 *ניהול שיווק דיגיטלי — JULIET.AI*

✅ ניהול אינסטגרם ו-TikTok
✅ אסטרטגיית תוכן חודשית
✅ פרסום ממומן וקמפיינים
✅ דוחות ביצועים

📲 לפרטים ומחירים — שלחי "מחירים"
או צרי קשר ישירות עם ג'וליאט 💎`,

  '4': `💰 *חבילות JULIET.AI:*

🥉 *Starter* — עיצוב בסיסי
🥈 *Growth* — עיצוב + וידאו
🥇 *VIP Monthly* — ניהול מלא

📲 לפרטים מדויקים ומחירים מותאמים אישית — שלחי הודעה לג'וליאט 💎
או כנסי לאתר: https://juliet-beauty-boutique.netlify.app/`
};

const BEAUTY_ANSWERS = {
  '1': `💆‍♀️ *החלקות אורגניות — Juliet Beauty*

✨ שלוש נוסחאות מתקדמות:
• *ELITE* — לשיער עבה ומתולתל
• *VELLUTO* — לשיער רגיש ודק
• *OXO ORGANIC* — ללא מגבלות אחרי הטיפול

💰 *מחירים:*
• חידוש שורשים (עד 12 ס"מ) — *850 ₪*
• החלקה מלאה — לפי אורך ועובי השיער

📸 שלחי תמונה ואשלח לך מחיר מדויק! 💎`,

  '2': `💇‍♀️ *תוספות שיער — Juliet Beauty*

6 שיטות מקצועיות:
🔗 קראטין (הדבקה) — *22 ₪ לגרם*
📿 צמידי שיער — *2,500 ₪ ל-100 גרם*
📎 קליפסים ועוד...

📸 שלחי תמונה של השיער שלך
ואעזור לך לבחור את השיטה המתאימה 💎`,

  '3': `🎨 *צבע והייליטס — Juliet Beauty*

✅ הייליטס
✅ בלייץ' מלא או חלקי
✅ אומברה / בלנדז'
✅ צבע מלא

📸 שלחי תמונה עם ההשראה שלך
ואחזור אליך עם מחיר מותאם 💎`
};

// ── קישור ביקורת גוגל ──────────────────────────────────────
const GOOGLE_REVIEW_LINK = 'https://g.page/r/CYKHuv_GXpMfEAE/review';

// ── טיימרים להצעה מיוחדת (יום שלם ללא מענה) ──────────────
const pendingOffers = {};

// ── עזר: שעה נוכחית ישראל ──────────────────────────────────
function getIsraelHour() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }) * 1;
}

// ── מילות פתיחה ─────────────────────────────────────────────
const GREETINGS = ['היי', 'הי', 'שלום', 'בוקר טוב', 'ערב טוב', 'תפריט', 'menu', 'התחל', 'start', 'hello', 'hi', '0'];

// ── לוגיקה ראשית ───────────────────────────────────────────
client.on('message', async (message) => {
  const from = message.from;

  // התעלם מקבוצות
  if (from.endsWith('@g.us')) return;
  if (message.isGroupMsg) return;
  if (message.id && message.id.remote && message.id.remote.endsWith('@g.us')) return;

  // התעלם מהודעות שלך
  if (message.fromMe) return;

  const body = message.body.trim();
  const bodyLower = body.toLowerCase();
  const hour = getIsraelHour();

  // בדיקת שם מה-CRM (גם אחרי ריסטרט)
  if (!userState[from]) {
    const crm = loadCRM();
    const cleanPhone = from.replace('@c.us', '').replace('972', '0');
    const existing = crm[cleanPhone];
    if (existing && existing.name) {
      userState[from] = { step: 'main', name: existing.name };
    }
  }

  // פתיחת שיחה — רק על מילות ברכה
  if (GREETINGS.some(g => bodyLower === g || bodyLower.startsWith(g + ' '))) {
    const knownName = userState[from] && userState[from].name;
    if (knownName) {
      // לקוחה ותיקה — פשוט שולח תפריט
      userState[from].step = 'main';
      await message.reply(`היי ${knownName} 💎 שמחה לשמוע ממך!\n\n${MAIN_MENU}`);
    } else {
      // לקוחה חדשה — שואלים שם
      userState[from] = { step: 'ask_name' };
      await message.reply(`היי 💎 ברוכה הבאה ל-*Juliet Universe*!\n\nאיך קוראים לך? 😊`);
    }
    return;
  }

  // אין state ואין ברכה — הבוט שותק
  if (!userState[from]) return;

  const state = userState[from];

  // ── שאלת שם ────────────────────────────────
  if (state.step === 'ask_name') {
    userState[from].name = body;
    userState[from].step = 'main';
    updateCustomer(from, { name: body });
    await message.reply(`נעים להכיר ${body}! 💎\n\n${MAIN_MENU}`);
    return;
  }

  const name = state.name || '';

  // ── תפריט ראשי ─────────────────────────────
  if (state.step === 'main') {
    if (body === '1') {
      userState[from].step = 'ai';
      await message.reply(AI_MENU);
    } else if (body === '2') {
      userState[from].step = 'beauty';
      await message.reply(BEAUTY_MENU);
    } else if (body === '3') {
      userState[from].step = 'faq';
      await message.reply(FAQ_MENU);
    } else if (body === '4') {
      // פנייה אישית — בדיקת שעה
      if (hour >= 20 || hour < 8) {
        await message.reply(`היי ${name} 💎\n\nתודה שפנית ל-*Juliet Universe*! 🙏\n\nשעות הפעילות שלנו: *08:00 — 20:00*\n\nנחזור אלייך בהקדם בשעות הפעילות 💎\n\nאפשר להשאיר הודעה ונחזור אלייך! 😊`);
        userState[from].step = 'personal_after_hours';
      } else {
        userState[from].step = 'personal';
        await message.reply(`💬 *פנייה אישית*\n\n${name ? `${name}, ` : ''}ג'וליאט תחזור אלייך בהקדם! 🙏\n\n📸 @juliet_beauty_boutique\n🌐 https://juliet-beauty-boutique.netlify.app/`);
      }
    } else {
      await message.reply(`בחרי מספר בין 1-4 בבקשה 😊\n\n${MAIN_MENU}`);
    }
    return;
  }

  // ── תפריט AI ───────────────────────────────
  if (state.step === 'ai') {
    if (body === '5') {
      userState[from].step = 'main';
      await message.reply(MAIN_MENU);
    } else if (AI_ANSWERS[body]) {
      await message.reply(AI_ANSWERS[body]);
      // הצעה מיוחדת אחרי מחירים
      setTimeout(async () => {
        await message.reply(`🔥 *רק השבוע — מבצע מיוחד!*\n\nקבעי פגישת ייעוץ חינמית עכשיו וקבלי *10% הנחה* על החבילה שתבחרי 💎\n\nכתבי *"רוצה"* ואחזור אלייך!`);
      }, 3000);
    } else {
      await message.reply(`בחרי מספר בין 1-5 בבקשה 😊\n\n${AI_MENU}`);
    }
    return;
  }

  // ── תפריט Beauty ───────────────────────────
  if (state.step === 'beauty') {
    // ביטול טיימר הצעה אם הלקוחה חזרה
    if (pendingOffers[from]) {
      clearTimeout(pendingOffers[from]);
      delete pendingOffers[from];
    }
    if (body === '4') {
      await message.reply(CATALOG_MESSAGE);
      // הצעה מיוחדת רק אם לא עונה 24 שעות
      pendingOffers[from] = setTimeout(async () => {
        try {
          const chat = await message.getChat();
          await chat.sendMessage(`היי ${name || ''} 💎\n\nשמנו לב שהסתכלת על השירותים שלנו!\n\n✨ *מבצע מיוחד רק בשבילך:*\nקבעי תור השבוע וקבלי *10% הנחה* 🎁\n\nכתבי *"רוצה לקבוע"* ואסדר אותך 😊`);
          delete pendingOffers[from];
        } catch(e) {}
      }, 24 * 60 * 60 * 1000);
    } else if (body === '5') {
      userState[from].step = 'main';
      await message.reply(MAIN_MENU);
    } else if (BEAUTY_ANSWERS[body]) {
      await message.reply(BEAUTY_ANSWERS[body]);
      // הצעה מיוחדת רק אם לא עונה 24 שעות
      pendingOffers[from] = setTimeout(async () => {
        try {
          const chat = await message.getChat();
          await chat.sendMessage(`היי ${name || ''} 💎\n\nעדיין מתלבטת? 😊\n\n🎁 *הצעה מיוחדת:* קבעי תור עד מחר וקבלי *10% הנחה*!\n\nכתבי *"רוצה לקבוע"* ואחזור אלייך 💇‍♀️`);
          userState[from] = { ...userState[from], step: 'booking' };
          delete pendingOffers[from];
        } catch(e) {}
      }, 24 * 60 * 60 * 1000);
      // שאלת קביעה מיידית (ללא הנחה)
      setTimeout(async () => {
        await message.reply(`💇‍♀️ ${name ? `${name}, ` : ''}רוצה לקבוע תור?\n\nכתבי *"קביעה"* ואסדר אותך 😊`);
        userState[from].step = 'booking';
      }, 4000);
    } else {
      await message.reply(`בחרי מספר בין 1-5 בבקשה 😊\n\n${BEAUTY_MENU}`);
    }
    return;
  }

  // ── קביעת תור ──────────────────────────────
  if (state.step === 'booking') {
    if (bodyLower.includes('קביעה') || bodyLower.includes('רוצה') || bodyLower.includes('כן')) {
      await message.reply(`מעולה ${name}! 💎\n\nשלחי לי:\n📅 *איזה יום* מתאים לך?\n⏰ *באיזו שעה*?\n\nוג'וליאט תאשר לך 🙏`);
      userState[from].step = 'confirm_booking';
    } else {
      userState[from].step = 'beauty';
      await message.reply(BEAUTY_MENU);
    }
    return;
  }

  // ── אישור תור ──────────────────────────────
  if (state.step === 'confirm_booking') {
    addVisit(from, state.lastService || 'תור כללי');
    updateCustomer(from, { pendingAppointment: body });
    await message.reply(`✅ קיבלתי! ג'וליאט תאשר את התור בקרוב 💎\n\nאחרי הביקור נשמח לשמוע איך היה! ⭐`);
    // תזכורת יום לפני (24 שעות)
    const reminderTime = 24 * 60 * 60 * 1000;
    setTimeout(async () => {
      try {
        const chat = await message.getChat();
        await chat.sendMessage(`היי ${name}! 💎\n\nרק תזכורת — יש לך תור אצלנו מחר!\n\n📍 Juliet Beauty Boutique\n\nמחכות לך! 🙏`);
      } catch(e) {}
    }, reminderTime);
    userState[from].step = 'main';
    return;
  }

  // ── FAQ ────────────────────────────────────
  if (state.step === 'faq') {
    if (body === '6') {
      userState[from].step = 'main';
      await message.reply(MAIN_MENU);
    } else if (FAQ_ANSWERS[body]) {
      await message.reply(FAQ_ANSWERS[body]);
    } else {
      await message.reply(`בחרי מספר בין 1-6 בבקשה 😊\n\n${FAQ_MENU}`);
    }
    return;
  }

  // ── פנייה אישית — שעות לילה ─────────────────
  if (state.step === 'personal_after_hours') {
    console.log(`📩 הודעה לילית מ-${from} (${name}): ${body}`);
    await message.reply(`תודה ${name}! 💎\n\nקיבלנו את ההודעה שלך ונחזור אלייך בשעות הפעילות — *08:00 — 20:00* 🙏`);
    return;
  }

  // ── Personal — ג'וליאט עונה ידנית ───────────
  if (state.step === 'personal') {
    console.log(`📩 הודעה אישית מ-${from} (${name}): ${body}`);
    return;
  }

  // ── בקשת ביקורת גוגל (כשלקוחה כותבת "ביקורת") ──
  if (bodyLower.includes('ביקורת') || bodyLower.includes('כוכבים') || bodyLower.includes('review')) {
    await message.reply(`תודה ${name}! 💎\n\nנשמח מאוד לביקורת!\n\n⭐ לחצי כאן:\n${GOOGLE_REVIEW_LINK}\n\nזה עוזר לנו להגיע לעוד לקוחות מדהימות כמוך! 🙏`);
    return;
  }
});

// ── QR & Ready ─────────────────────────────────────────────
client.on('qr', (qr) => {
  currentQR = qr;
  console.log('\n💎 סרקי את ה-QR — פתחי בדפדפן הטלפון: [כתובת השרת]/qr\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('\n✅ הבוט של ג\'וליאט פעיל! 💎\n');
  console.log('לקוחות שכותבות "היי" יקבלו תפריט אוטומטי\n');
});

client.on('auth_failure', () => {
  console.log('❌ שגיאת חיבור — נסי שוב');
});

client.initialize();