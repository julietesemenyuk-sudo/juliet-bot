const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── יומן תורים פנויים ───────────────────────────────────────
const SLOTS_FILE = path.join(__dirname, 'slots.json');

function loadSlots() {
  if (!fs.existsSync(SLOTS_FILE)) fs.writeFileSync(SLOTS_FILE, '[]');
  try { return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf8')); } catch(e) { return []; }
}

function saveSlots(data) {
  fs.writeFileSync(SLOTS_FILE, JSON.stringify(data, null, 2));
}

function getAvailableSlots() {
  const now = new Date();
  return loadSlots().filter(s => !s.booked && new Date(s.datetime) > now);
}

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
  },
  webVersionCache: { type: 'none' },
  // אל תצפה בסטורי ואל תסמן כנקרא
  markOnlineOnConnect: false,
  restartOnAuthFail: true
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

// ── חישוב 5 ימים קרובים ─────────────────────────────────────
const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function getNextDays() {
  const days = [];
  const today = new Date();
  for (let i = 1; i <= 6; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = DAYS_HE[d.getDay()];
    const dateStr = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    days.push({ label: `יום ${dayName} ${dateStr}`, date: d.toISOString() });
  }
  return days;
}

// ── מילות פתיחה ─────────────────────────────────────────────
const GREETINGS = ['היי', 'הי', 'שלום', 'בוקר טוב', 'ערב טוב', 'תפריט', 'menu', 'התחל', 'start', 'hello', 'hi', '0'];

// ── מספר ג'וליאט ────────────────────────────────────────────
const JULIET_NUMBER = '972586210365@c.us';

// ── פקודות ג'וליאט לאישור/ביטול תורים ───────────────────────
async function handleJulietCommand(message) {
  const body = message.body.trim();

  // ── הוספת תורים פנויים ──────────────────────────────────
  // פורמט: "פנויים" ואז רשימה כמו:
  // שישי 28/3 09:00
  // שישי 28/3 11:00
  // שני 31/3 10:00
  if (body.startsWith('פנויים') || body.startsWith('תורים')) {
    const lines = body.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      await message.reply(
        `💎 *הוספת תורים פנויים*\n\n` +
        `שלחי בפורמט:\n\`\`\`פנויים\nשישי 28/3 09:00\nשישי 28/3 11:00\nשני 31/3 10:00\`\`\`\n\n` +
        `כל שורה = תור אחד 📅`
      );
      return;
    }

    const DAYS_MAP = { 'ראשון':0,'שני':1,'שלישי':2,'רביעי':3,'חמישי':4,'שישי':5,'שבת':6 };
    const slots = loadSlots();
    let added = 0, errors = [];

    for (const line of lines) {
      // מנתח: "שישי 28/3 09:00" או "שישי 09:00"
      const match = line.match(/(\S+)\s+(?:(\d{1,2})\/(\d{1,2})\s+)?(\d{1,2}:\d{2})/);
      if (!match) { errors.push(line); continue; }

      const [, dayName, dayNum, monthNum, time] = match;
      const [h, m] = time.split(':').map(Number);
      let date = new Date();

      if (dayNum && monthNum) {
        // תאריך מפורש
        date = new Date(date.getFullYear(), parseInt(monthNum) - 1, parseInt(dayNum), h, m);
      } else {
        // מצא את היום הקרוב ביותר
        const targetDay = DAYS_MAP[dayName];
        if (targetDay === undefined) { errors.push(line); continue; }
        const diff = (targetDay - date.getDay() + 7) % 7 || 7;
        date.setDate(date.getDate() + diff);
        date.setHours(h, m, 0, 0);
      }

      // בדוק שלא קיים כבר
      const key = date.toISOString();
      if (!slots.find(s => s.datetime === key)) {
        slots.push({ datetime: key, label: `${dayName} ${date.toLocaleDateString('he-IL')} ${time}`, booked: false });
        added++;
      }
    }

    saveSlots(slots);
    let reply = `✅ נוספו *${added}* תורים פנויים!\n\n📅 *תורים פנויים לשבוע הקרוב:*\n`;
    const available = getAvailableSlots().slice(0, 10);
    reply += available.map((s, i) => `${i+1}. ${s.label}`).join('\n');
    if (errors.length) reply += `\n\n⚠️ לא הבנתי: ${errors.join(', ')}`;
    await message.reply(reply);
    return;
  }

  // ── הצגת תורים פנויים ───────────────────────────────────
  if (body === 'תורים פנויים' || body === 'פנוי' || body === 'יומן') {
    const available = getAvailableSlots();
    if (!available.length) {
      await message.reply(`📅 אין תורים פנויים מוגדרים.\n\nשלחי \`פנויים\` עם רשימה להוסיף.`);
    } else {
      await message.reply(`📅 *תורים פנויים:*\n\n` + available.map((s,i) => `${i+1}. ${s.label}`).join('\n'));
    }
    return;
  }

  // ── מחיקת תורים ────────────────────────────────────────
  if (body === 'נקה תורים' || body === 'מחק תורים') {
    saveSlots([]);
    await message.reply(`🗑️ כל התורים הפנויים נמחקו.`);
    return;
  }

  // פורמט: "אישרתי 0521234567 10:00" או "ביטלתי 0521234567"
  const confirmMatch = body.match(/אישרתי\s+(05\d{8})\s+(\d{1,2}:\d{2})/);
  const cancelMatch  = body.match(/ביטלתי\s+(05\d{8})/);

  if (confirmMatch) {
    const phone = confirmMatch[1];
    const time  = confirmMatch[2];
    const crm   = loadCRM();
    if (!crm[phone]) { await message.reply(`❌ לא נמצאה לקוחה ${phone}`); return; }

    // בנה תאריך מהבקשה השמורה
    const req = crm[phone].pendingAppointmentRequest || '';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const [h, m]   = time.split(':').map(Number);
    const apptDate = new Date(tomorrow);
    apptDate.setHours(h, m, 0, 0);
    crm[phone].pendingAppointment = apptDate.toISOString();
    crm[phone].reminderSent = false;
    saveCRM(crm);

    // אשר ללקוחה
    const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
    const custName = crm[phone].name || 'יקרה';
    try {
      await client.sendMessage(chatId,
        `✅ *אושר!* ${custName} 💎\n\nהתור שלך נקבע לשעה *${time}*\n📍 Juliet Beauty Boutique\n\nמחכות לך! 🌟\n\n_(תקבלי תזכורת יום לפני)_`
      );
    } catch(e) {}

    await message.reply(`✅ אישרתי ל-${phone} בשעה ${time} — תזכורת תישלח אוטומטית יום לפני!`);
    return;
  }

  if (cancelMatch) {
    const phone = cancelMatch[1];
    const crm   = loadCRM();
    if (!crm[phone]) { await message.reply(`❌ לא נמצאה לקוחה ${phone}`); return; }
    delete crm[phone].pendingAppointment;
    delete crm[phone].pendingAppointmentRequest;
    delete crm[phone].reminderSent;
    saveCRM(crm);

    const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
    const custName = crm[phone].name || 'יקרה';
    try {
      await client.sendMessage(chatId,
        `שלום ${custName} 💎\n\nלצערנו התור לא יכול להתקיים בזמן המבוקש.\nתרצי לקבוע זמן אחר? כתבי לנו ונשמח לעזור 🙏`
      );
    } catch(e) {}

    await message.reply(`✅ ביטלתי את התור של ${phone} — הלקוחה קיבלה הודעה.`);
    return;
  }

  // הוראות שימוש אם ג'וליאט כתבה משהו לא מובן
  if (body.startsWith('אישרתי') || body.startsWith('ביטלתי')) {
    await message.reply(
      `💎 *פקודות לניהול תורים:*\n\n` +
      `✅ אישור: \`אישרתי 05XXXXXXXX HH:MM\`\n` +
      `❌ ביטול: \`ביטלתי 05XXXXXXXX\`\n\n` +
      `_דוגמה: אישרתי 0521234567 10:30_`
    );
  }
}

// ── לוגיקה ראשית ───────────────────────────────────────────
client.on('message', async (message) => {
  const from = message.from;

  // התעלם מקבוצות
  if (from.endsWith('@g.us')) return;
  if (message.isGroupMsg) return;
  if (message.id && message.id.remote && message.id.remote.endsWith('@g.us')) return;

  // התעלם מסטורי / סטטוס
  if (from === 'status@broadcast') return;
  if (message.type === 'status') return;
  if (from.includes('broadcast')) return;
  if (message.isStatus) return;

  // פקודות ג'וליאט לניהול תורים
  if (from === JULIET_NUMBER && !message.fromMe) {
    await handleJulietCommand(message);
    return;
  }

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

  // ── קביעת תור — שלב 1: בחירת תור פנוי ──────────────────────
  if (state.step === 'booking') {
    if (bodyLower.includes('קביעה') || bodyLower.includes('רוצה') || bodyLower.includes('כן') || body === '4') {
      const available = getAvailableSlots();
      if (available.length > 0) {
        // יש תורים מוגדרים — הצג אותם
        userState[from].step = 'booking_slot';
        userState[from].slotOptions = available.slice(0, 8);
        await message.reply(
          `מעולה ${name}! 💎 נקבע לך תור 📅\n\n*בחרי תור פנוי:*\n\n` +
          available.slice(0, 8).map((s, i) => `${i + 1}. ${s.label}`).join('\n') +
          `\n\nשלחי את המספר המתאים 😊`
        );
      } else {
        // אין תורים מוגדרים — שאלה חופשית
        const days = getNextDays();
        userState[from].step = 'booking_day';
        userState[from].dayOptions = days;
        await message.reply(
          `מעולה ${name}! 💎 נקבע לך תור 📅\n\n*איזה יום מתאים?*\n\n` +
          days.map((d, i) => `${i + 1}. ${d.label}`).join('\n') +
          `\n\nשלחי את המספר המתאים 😊`
        );
      }
    } else {
      userState[from].step = 'beauty';
      await message.reply(BEAUTY_MENU);
    }
    return;
  }

  // ── קביעת תור — שלב 1ב: בחירה מתורים פנויים ────────────────
  if (state.step === 'booking_slot') {
    const idx = parseInt(body) - 1;
    const slots = state.slotOptions || [];
    if (idx >= 0 && idx < slots.length) {
      const chosen = slots[idx];
      userState[from].selectedSlot = chosen;
      userState[from].step = 'booking_slot_confirm';
      await message.reply(
        `נהדר! בחרת *${chosen.label}* 💎\n\n` +
        `לאישור הבקשה — שלחי *כן* ✅`
      );
    } else {
      await message.reply(`שלחי בבקשה מספר בין 1-${slots.length} 🙏`);
    }
    return;
  }

  if (state.step === 'booking_slot_confirm') {
    if (bodyLower.includes('כן') || bodyLower.includes('אישור') || bodyLower.includes('ok')) {
      const chosen = state.selectedSlot;
      const service = state.lastService || 'שירות כללי';

      // סמן תור כתפוס
      const slots = loadSlots();
      const slot = slots.find(s => s.datetime === chosen.datetime);
      if (slot) { slot.booked = true; slot.bookedBy = name; slot.bookedPhone = from.replace('@c.us',''); }
      saveSlots(slots);
      updateCustomer(from, { pendingAppointmentRequest: `${chosen.label} — ${service}` });

      await message.reply(
        `✅ *הבקשה נשלחה לג'וליאט!*\n\n` +
        `📅 ${chosen.label}\n💇‍♀️ ${service}\n\n` +
        `ג'וליאט תאשר בקרוב 💎🙏`
      );

      // התראה לג'וליאט
      const customerPhone = from.replace('@c.us', '');
      try {
        await client.sendMessage(JULIET_NUMBER,
          `💎 *בקשת תור חדשה!*\n\n` +
          `👤 שם: *${name}*\n📞 טלפון: *${customerPhone}*\n` +
          `📅 זמן: *${chosen.label}*\n💇‍♀️ שירות: *${service}*\n\n` +
          `לאישור: \`אישרתי ${customerPhone} ${chosen.label.split(' ').pop()}\`\n` +
          `לביטול: \`ביטלתי ${customerPhone}\``
        );
      } catch(e) {}
      userState[from].step = 'main';
    } else {
      userState[from].step = 'main';
      await message.reply(`בסדר! כשתרצי לקבוע שלחי *קביעה* 😊`);
    }
    return;
  }

  // ── קביעת תור — שלב 2: בחירת שעה ──────────────────────────
  if (state.step === 'booking_day') {
    const idx = parseInt(body) - 1;
    const days = state.dayOptions || [];
    if (idx >= 0 && idx < days.length) {
      userState[from].selectedDay = days[idx];
      userState[from].step = 'booking_time';
      await message.reply(
        `נהדר! *${days[idx].label}* 💎\n\n*באיזו שעה נוח לך?*\n\n` +
        `1. בוקר (09:00-11:00)\n2. צהריים (11:00-14:00)\n3. אחר הצהריים (14:00-17:00)\n4. ערב (17:00-20:00)\n\nשלחי את המספר 😊`
      );
    } else {
      await message.reply(`שלחי בבקשה מספר בין 1-${days.length} 🙏`);
    }
    return;
  }

  // ── קביעת תור — שלב 3: שליחה לג'וליאט ──────────────────────
  if (state.step === 'booking_time') {
    const timeSlots = { '1': 'בוקר (09:00-11:00)', '2': 'צהריים (11:00-14:00)', '3': 'אחה"צ (14:00-17:00)', '4': 'ערב (17:00-20:00)' };
    const timeSlot = timeSlots[body];
    if (!timeSlot) {
      await message.reply(`שלחי בבקשה מספר בין 1-4 🙏`);
      return;
    }
    const day = state.selectedDay;
    const service = state.lastService || 'שירות כללי';

    // שמור ב-CRM עם פרטי הבקשה
    updateCustomer(from, { pendingAppointmentRequest: `${day.label} ${timeSlot} — ${service}` });

    // שלח ללקוחה אישור
    await message.reply(
      `✅ *קיבלנו את הבקשה שלך!*\n\n` +
      `📅 יום: *${day.label}*\n⏰ שעה: *${timeSlot}*\n💇‍♀️ שירות: *${service}*\n\n` +
      `ג'וליאט תאשר את התור בקרוב ותשלח לך אישור סופי 💎🙏`
    );

    // שלח התראה לג'וליאט
    const customerPhone = from.replace('@c.us', '');
    try {
      await client.sendMessage(JULIET_NUMBER,
        `💎 *בקשת תור חדשה!*\n\n` +
        `👤 שם: *${name}*\n📞 טלפון: *${customerPhone}*\n` +
        `📅 יום: *${day.label}*\n⏰ שעה: *${timeSlot}*\n💇‍♀️ שירות: *${service}*\n\n` +
        `לאישור — כתבי ללקוחה ב-WhatsApp ועדכני את התור ב-CRM 🙏`
      );
    } catch(e) {
      console.log('שגיאה בשליחה לג\'וליאט:', e.message);
    }

    userState[from].step = 'main';
    return;
  }

  // ── אישור תור סופי (אחרי שג'וליאט מאשרת) ───────────────────
  if (state.step === 'confirm_booking') {
    addVisit(from, state.lastService || 'תור כללי');
    // חשב תאריך מדויק מהבחירה
    const apptDate = state.selectedDay ? new Date(state.selectedDay.date) : null;
    if (apptDate) {
      updateCustomer(from, { pendingAppointment: apptDate.toISOString(), reminderSent: false });
    }
    await message.reply(`✅ התור אושר! ג'וליאט מחכה לך 💎\n\nתקבלי תזכורת יום לפני 🗓️`);
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

// ── זיהוי שירות מהודעות עבר ─────────────────────────────────
const SERVICE_KEYWORDS = {
  'החלקה אורגנית': ['החלק', 'אורגנית', 'אורגני'],
  'קרטין': ['קרטין'],
  'תוספות שיער': ['תוספות', 'תוסף'],
  'צבע ועיצוב': ['צבע', 'גוון', 'הבהרה', 'אומברה', 'בלונד', 'שורשים'],
  'תספורת': ['תספורת', 'קיצוץ', 'קצצתי'],
  'פן': ['פן', 'פן חם', 'ישור'],
  'טיפול שיער': ['טיפול', 'מסכה', 'לחות'],
};

function detectService(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    if (keywords.some(k => t.includes(k))) return service;
  }
  return null;
}

async function scanPastMessages() {
  console.log('\n🔍 סורק הודעות עבר לזיהוי שירותים...');
  try {
    const chats = await client.getChats();
    let updated = 0;
    const crm = loadCRM();

    for (const chat of chats) {
      if (chat.isGroup) continue;
      const phone = '0' + chat.id.user.replace('972', '');
      const customer = crm[phone];
      if (!customer) continue;

      try {
        const messages = await chat.fetchMessages({ limit: 50 });
        for (const msg of messages.reverse()) {
          if (!msg.body) continue;
          const service = detectService(msg.body);
          if (service) {
            if (!crm[phone].lastService) {
              crm[phone].lastService = service;
              updated++;
            }
            break;
          }
        }
      } catch(e) {}
    }

    saveCRM(crm);
    console.log(`✅ עודכנו ${updated} לקוחות עם שירות אחרון`);
  } catch(e) {
    console.log('שגיאה בסריקה:', e.message);
  }
}

// ── תזכורת יום לפני תור ──────────────────────────────────────
function startReminderJob() {
  setInterval(async () => {
    const crm = loadCRM();
    const now = Date.now();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toLocaleDateString('he-IL');

    for (const [phone, customer] of Object.entries(crm)) {
      if (!customer.pendingAppointment) continue;
      const apptTime = new Date(customer.pendingAppointment).getTime();
      const hoursUntil = (apptTime - now) / 3600000;

      // שלח תזכורת 20-24 שעות לפני
      if (hoursUntil > 20 && hoursUntil <= 24 && !customer.reminderSent) {
        const name = customer.name || 'יקרה';
        const apptStr = new Date(customer.pendingAppointment).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
        try {
          const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
          await client.sendMessage(chatId,
            `💎 תזכורת תור — Juliet Beauty Boutique\n\nשלום ${name}! 🌟\n\nמזכירים לך שיש לך תור *מחר* בשעה *${apptStr}*\n\nאנחנו מחכים לך! 💫\n\nאם צריך לשנות — שלחי לנו הודעה 🙏`
          );
          crm[phone].reminderSent = true;
          saveCRM(crm);
          console.log(`📅 נשלחה תזכורת ל-${phone}`);
        } catch(e) {}
      }
    }
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

client.on('ready', () => {
  console.log('\n✅ הבוט של ג\'וליאט פעיל! 💎\n');
  console.log('לקוחות שכותבות "היי" יקבלו תפריט אוטומטי\n');
  // סרוק הודעות עבר לזיהוי שירותים
  setTimeout(scanPastMessages, 5000);
  // הפעל תזכורות תורים
  startReminderJob();

  // מנע צפייה אוטומטית בסטורי
  try {
    client.pupPage.evaluate(() => {
      window.WAPI && window.WAPI.unsubscribePresence && window.WAPI.unsubscribePresence();
    }).catch(() => {});
  } catch(e) {}
});

// התעלם לחלוטין מאירועי סטורי
client.on('message_create', (msg) => {
  if (msg.from === 'status@broadcast' || msg.isStatus || (msg.from && msg.from.includes('broadcast'))) return;
});

client.on('auth_failure', () => {
  console.log('❌ שגיאת חיבור — נסי שוב');
});

client.initialize();