require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

// ── Claude AI ──────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function askClaude(customerMessage, customerName, chatHistory) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const systemPrompt = `את ג'ולייט — מעצבת שיער ויוצרת AI מישראל, אשדוד.
הסלון שלך: Juliet Beauty Boutique (הציונות 61 דירה 14, אשדוד).
שירותים: החלקה אורגנית OXO (חידוש שורשים 850₪, מלאה מ-1000₪), תוספות שיער (קראטין 22₪/גרם, צמידים 2500₪/100גרם), צבע והייליטס.
שפה: ענה תמיד בעברית, קצר וחם, ספציפי. השתמש ב-💎 לעיתים. בסוף הצעה כשרלוונטי: "כתבי קביעה לתאם תור" או "שלחי תמונה לקבל מחיר מותאם".
אל תמציא מחירים שלא צוינו. אל תהבטיח דברים שלא בטוחים.`;

    const messages = [];
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.slice(-4).forEach(h => {
        messages.push({ role: h.from === 'customer' ? 'user' : 'assistant', content: h.text });
      });
    }
    messages.push({ role: 'user', content: customerMessage });

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages
    });
    return res.content[0]?.text || null;
  } catch(e) {
    console.log('⚠️ Claude AI שגיאה:', e.message);
    return null;
  }
}

// ── Email — התראת ניתוק ──────────────────────────────────────────
const ALERT_EMAIL = process.env.ALERT_EMAIL || '';
const ALERT_EMAIL_PASS = process.env.ALERT_EMAIL_PASS || '';

async function sendDisconnectEmail(reason) {
  const topic = process.env.NTFY_TOPIC || 'juliet-bot-alerts-5865';
  try {
    const body = JSON.stringify({
      topic,
      title: '⚠️ הבוט של ג\'ולייט התנתק!',
      message: `זמן: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}\nסיבה: ${reason}\nמנסה להתחבר מחדש...`,
      priority: 5,
      tags: ['warning', 'robot']
    });
    const req = https.request({
      hostname: 'ntfy.sh',
      path: '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    });
    req.on('error', () => {});
    req.write(body);
    req.end();
    console.log('📲 התראת ניתוק נשלחה ל-ntfy');
  } catch(e) {
    console.log('⚠️ שגיאת ntfy:', e.message);
  }
}

// ── מניעת קריסה מ-unhandled errors ───────────────────────────
process.on('uncaughtException', (err) => {
  console.error('⚠️ uncaughtException (לא קריסה):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ unhandledRejection (לא קריסה):', reason?.message || reason);
});

// ── Tunnel / URL ציבורי ────────────────────────────────────────
let publicTunnelUrl = '';
let leeSyncStatus = { running: false, lastRun: null, added: 0, total: 0, error: null };

// האם רץ על Railway?
const IS_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN);

if (IS_RAILWAY) {
  // על Railway — הכתובת הציבורית ניתנת על-ידי Railway עצמו
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || '';
  publicTunnelUrl = domain ? `https://${domain}` : '';
  console.log(`🚂 Railway mode — URL: ${publicTunnelUrl || '(ממתין לדומיין)'}`);
} else {
  // לוקל — Cloudflare Tunnel
  function startTunnel() {
    const tunnel = spawn('cloudflared', [
      'tunnel', '--url', 'http://localhost:3000',
      '--no-autoupdate'
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });

    let announced = false;

    const onData = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !announced) {
        announced = true;
        publicTunnelUrl = match[0];
        const crmUrl = publicTunnelUrl + '/crm?pass=juliet2026';
        fs.writeFileSync(path.join(__dirname, 'tunnel-url.txt'), publicTunnelUrl);
        console.log(`\n🌐 Cloudflare Tunnel פעיל: ${publicTunnelUrl}`);
        console.log(`📱 CRM: ${crmUrl}\n`);
        setTimeout(() => {
          try {
            client.sendMessage('972586210365@c.us',
              `🌐 *הבוט פעיל!* 💎\n\n` +
              `📱 *כתובת ה-CRM שלך:*\n${crmUrl}\n\n` +
              `_שמרי כ-shortcut על מסך הבית_\n` +
              `_הכתובת תשתנה רק כשהמחשב יופעל מחדש_ 💎`
            );
          } catch(e) {}
        }, 15000);
      }
    };

    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', () => {
      announced = false;
      publicTunnelUrl = '';
      console.log('⚠️ Cloudflare tunnel נסגר — מחדש בעוד 5 שניות...');
      setTimeout(startTunnel, 5000);
    });
  }

  startTunnel();
}

// ── תיקיית נתונים — /data על Railway, __dirname לוקל ──────────
const DATA_DIR = IS_RAILWAY ? '/data' : __dirname;
if (IS_RAILWAY && !fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}

// ── אם FORCE_QR=1 — מחק סשן ישן בהפעלה ─────────────────────
if (process.env.FORCE_QR === '1') {
  const authPath = IS_RAILWAY ? '/data/.wwebjs_auth' : path.join(__dirname, '.wwebjs_auth');
  try {
    fs.rmSync(authPath, { recursive: true, force: true });
    console.log('🗑️ FORCE_QR: סשן נמחק — ממתין ל-QR חדש');
  } catch(e) {
    console.log('⚠️ FORCE_QR: שגיאה במחיקה:', e.message);
  }
}

// ── יומן תורים פנויים ───────────────────────────────────────
const SLOTS_FILE = path.join(DATA_DIR, 'slots.json');

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

// ── תזכורות אישיות ──────────────────────────────────────────
const REMINDERS_FILE = IS_RAILWAY ? '/data/reminders.json' : path.join(__dirname, 'reminders.json');
function loadReminders() {
  if (!fs.existsSync(REMINDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8')); } catch(e) { return []; }
}
function saveReminders(data) { fs.writeFileSync(REMINDERS_FILE, JSON.stringify(data, null, 2)); }

// ── CRM ─────────────────────────────────────────────────────
const CRM_FILE = path.join(DATA_DIR, 'customers.json');
const CRM_FILE_BUNDLED = path.join(__dirname, 'customers.json');
// על Railway — העתק customers.json מהריפו אם הגרסה שלנו גדולה יותר
if (IS_RAILWAY && fs.existsSync(CRM_FILE_BUNDLED)) {
  try {
    const bundledData = JSON.parse(fs.readFileSync(CRM_FILE_BUNDLED, 'utf8'));
    const bundledCount = Object.keys(bundledData).length;
    let volumeCount = 0;
    if (fs.existsSync(CRM_FILE)) {
      try { volumeCount = Object.keys(JSON.parse(fs.readFileSync(CRM_FILE, 'utf8'))).length; } catch(e) {}
    }
    if (bundledCount > volumeCount) {
      fs.copyFileSync(CRM_FILE_BUNDLED, CRM_FILE);
      console.log(`📋 customers.json עודכן: ${volumeCount} → ${bundledCount} לקוחות`);
    } else {
      console.log(`📋 customers.json: volume(${volumeCount}) >= bundled(${bundledCount}) — ללא שינוי`);
    }
  } catch(e) { console.log('⚠️ שגיאת sync CRM:', e.message); }
}

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

// ── Google Sheets Webhook ────────────────────────────────────
const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK || 'https://script.google.com/macros/s/AKfycbxstcTo47uPhhTlNSG5zVvR-FKvgiifqLpEbyzlhBEZ6SsAZizQ4AEZsYdQIrcadQY/exec';

function sendToGoogleSheets(data) {
  if (!SHEETS_WEBHOOK) return;
  try {
    const url = new URL(SHEETS_WEBHOOK);
    const body = JSON.stringify({ ...data, timestamp: new Date().toISOString() });
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => console.log('✅ גוגל שיטס:', res.statusCode));
    req.on('error', e => console.log('❌ שיטס:', e.message));
    req.write(body);
    req.end();
  } catch(e) { console.log('❌ שיטס שגיאה:', e.message); }
}

// ── הודעה לג'ולייט עם הקשר לקוחה + הצעות פעולה ──────────────
async function notifyJulietWithContext(from, name, customerMsg, aiReply, crm) {
  const cleanPhone = from.replace('@c.us','').replace('972','0');
  const cust = crm[cleanPhone] || {};
  const visits = (cust.visits || []).length;
  const lastService = cust.lastService || '';
  const isNew = visits === 0 && !lastService;
  const chatLog = (cust.chatLog || []).slice(-3).map(m => `${m.from === 'customer' ? '👤' : '🤖'} ${m.text}`).join('\n');

  const contextLine = isNew
    ? `🆕 *לקוחה חדשה*`
    : `🔄 ${visits} ביקורים${lastService ? ` | אחרון: ${lastService}` : ''}`;

  try {
    await client.sendMessage(JULIET_NUMBER,
      `💬 *הודעה מ${name || cleanPhone}*\n` +
      `${contextLine}\n` +
      `─────────────────\n` +
      `👤 "${customerMsg}"\n` +
      `─────────────────\n` +
      `🤖 *הבוט ענה:*\n"${aiReply}"\n\n` +
      `📌 *פקודות מהירות:*\n` +
      `▪️ \`שלחי ${cleanPhone} [הודעה]\` — שלחי הודעה ישירות\n` +
      `▪️ \`תאמי ${cleanPhone}\` — התחילי תהליך קביעת תור\n` +
      `▪️ \`מחיר ${cleanPhone} [סכום]\` — שלחי פיץ' מחיר\n` +
      `▪️ \`השתק ${cleanPhone}\` — השתיקי את הבוט 3 שעות`
    );
  } catch(e) {}
}

// ── שליחת הודעה ישירות ללקוחה על-פי פקודת ג'ולייט ───────────
// פורמט: "שלחי 0521234567 הטקסט כאן"
// פורמט: "תאמי 0521234567" — מתחיל תהליך קביעת תור
// ── Follow-up אוטומטי ל-Leads של AI ─────────────────────────
const aiFollowups = {};

function scheduleAIFollowup(from, name, service) {
  // ביטול קיים
  if (aiFollowups[from]) {
    clearTimeout(aiFollowups[from].t24);
    clearTimeout(aiFollowups[from].t48);
  }
  // 24 שעות
  const t24 = setTimeout(async () => {
    try {
      await client.sendMessage(from,
        `היי ${name} 💎\n\nרציתי לבדוק — עדיין מעוניינת ב*${service}*?\n\nאני כאן לכל שאלה, כתבי לי 😊`
      );
    } catch(e) {}
  }, 24 * 60 * 60 * 1000);
  // 48 שעות
  const t48 = setTimeout(async () => {
    try {
      await client.sendMessage(from,
        `היי ${name} 💎\n\n🎁 *הצעה מיוחדת בשבילך:*\nקבעי שיחת ייעוץ חינמית עם ג'ולייט עד מחר וקבלי *10% הנחה* על כל חבילה! 🔥\n\nכתבי *"רוצה"* ואסדר 😊`
      );
    } catch(e) {}
    delete aiFollowups[from];
  }, 48 * 60 * 60 * 1000);
  aiFollowups[from] = { t24, t48 };
}

// ── שרת CRM — נגיש מכל מקום ────────────────────────────────
const CRM_HTML = path.join(__dirname, 'crm.html');
const CRM_PASS = process.env.CRM_PASSWORD || 'juliet2026';
let currentQR = null; // שמירת ה-QR הנוכחי
let clientReady = false; // האם הבוט מחובר באמת

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // דף QR לסריקה
  // ── Reset session ─────────────────────────────────────────
  if (url.pathname === '/reset-session') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body style="background:#000;color:#c8a84b;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh"><h2>♻️ מנקה סשן... הבוט יופעל מחדש בעוד 5 שניות</h2></body></html>');
    console.log('🔄 מאפס סשן WhatsApp לפי בקשה...');
    setTimeout(async () => {
      try {
        await client.logout();
      } catch(e) {}
      try {
        await client.destroy();
      } catch(e) {}
      // מחק תיקיית auth
      const authPath = IS_RAILWAY ? '/data/.wwebjs_auth' : path.join(__dirname, '.wwebjs_auth');
      try { fs.rmSync(authPath, { recursive: true, force: true }); console.log('✅ סשן נמחק'); } catch(e) {}
      process.exit(0); // Railway יפעיל מחדש אוטומטית
    }, 1000);
    return;
  }

  if (url.pathname === '/qr') {
    if (currentQR) {
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(currentQR);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
        <h2 style="color:#c8a84b;font-family:Arial">💎 סרקי עם WhatsApp</h2>
        <img src="${qrUrl}" style="width:300px;height:300px;border:4px solid #c8a84b;border-radius:12px"/>
        <p style="color:#888;font-family:Arial;margin-top:16px">הגדרות → מכשירים מקושרים → קשרי מכשיר</p>
        <script>setTimeout(()=>location.reload(),25000)</script>
      </body></html>`);
    } else if (clientReady) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="background:#000;color:#c8a84b;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:20px">
        <h2>✅ הבוט מחובר! אין צורך ב-QR</h2>
        <a href="/reset-session" style="color:#888;font-size:14px;font-family:Arial">לא עובד? לחצי כאן לאיפוס חיבור</a>
      </body></html>`);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="background:#000;color:#c8a84b;font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:20px">
        <h2>⏳ הבוט מתחיל... מחכה ל-QR</h2>
        <p style="color:#888;font-family:Arial;font-size:14px">רענני את הדף בעוד 10 שניות</p>
        <script>setTimeout(()=>location.reload(),10000)</script>
      </body></html>`);
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

  // ── webhook מ-lee — תור חדש ──────────────────────────────
  if (url.pathname === '/lee-webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('📅 webhook מlee:', JSON.stringify(data).substring(0,200));
        const crm = loadCRM();

        // שדות נפוצים ב-lee webhook
        const name    = data.customerName || data.client_name || data.name || 'לקוחה';
        const phone   = (data.customerPhone || data.phone || data.mobile || '').replace(/\D/g,'');
        const apptDate= data.appointmentDate || data.date || data.start || data.startTime;
        const service = data.serviceName || data.service || data.treatment || '';
        const status  = data.status || data.appointmentStatus || '';

        if (phone && apptDate) {
          const cleanPhone = phone.startsWith('972') ? '0' + phone.slice(3) : phone;
          if (!crm[cleanPhone]) crm[cleanPhone] = { phone: cleanPhone, firstContact: new Date().toISOString(), visits: [] };
          crm[cleanPhone].name = name;
          crm[cleanPhone].lastService = service;
          crm[cleanPhone].businessType = 'beauty';
          crm[cleanPhone].lastSeen = new Date().toISOString();
          crm[cleanPhone].source = 'lee';
          crm[cleanPhone].visits = crm[cleanPhone].visits || [];

          const apptISO = new Date(apptDate).toISOString();

          if (status === 'cancelled' || status === 'canceled') {
            // סמן ביטול ב-visits
            delete crm[cleanPhone].pendingAppointment;
            const v = crm[cleanPhone].visits.find(v => v.date === apptISO && v.source === 'lee');
            if (v) v.status = 'cancelled';
          } else {
            // שמור ב-pendingAppointment וגם ב-visits[] לתצוגת יומן
            crm[cleanPhone].pendingAppointment = apptISO;
            const exists = crm[cleanPhone].visits.some(v => v.date === apptISO && v.source === 'lee');
            if (!exists) {
              crm[cleanPhone].visits.push({
                date: apptISO,
                service: service || 'טיפול',
                source: 'lee',
                status: 'scheduled'
              });
            }
          }
          saveCRM(crm);
          console.log(`✅ lee webhook — עודכן: ${name} (${cleanPhone}) ${apptDate}`);
          // עדכון ג'ולייט בוואטסאפ
          if (client.info && status !== 'cancelled') {
            client.sendMessage(JULIET_NUMBER,
              `📅 *תור חדש מlee!*\n\n👤 *${name}*\n📞 ${cleanPhone}\n💇 ${service}\n🗓 ${new Date(apptDate).toLocaleDateString('he-IL')} ${new Date(apptDate).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`
            ).catch(()=>{});
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) {
        console.log('שגיאה ב-webhook:', e.message);
        res.writeHead(200); res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // ── שמירת תור ידנית מה-CRM ──────────────────────────────────
  if (url.pathname === '/save-appointment' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const crm = loadCRM();
        const phone = (d.phone || '').replace(/\D/g,'').replace(/^972/,'0');
        if (!phone) { res.writeHead(400); res.end('{}'); return; }
        if (!crm[phone]) crm[phone] = { phone, name: d.name || 'לקוחה', firstContact: new Date().toISOString(), visits: [], source: 'crm' };
        if (d.name) crm[phone].name = d.name;
        // מיזוג lee_ כפילויות — אם יש רשומת lee_ עם אותו שם, העבר ביקורים ומחק
        const nameLower = (d.name||'').trim().toLowerCase();
        if (nameLower) {
          Object.keys(crm).forEach(k => {
            if (k.startsWith('lee_') && (crm[k].name||'').trim().toLowerCase() === nameLower) {
              (crm[k].visits||[]).forEach(v => {
                const exists = (crm[phone].visits||[]).some(vv => vv.date === v.date && vv.service === v.service);
                if (!exists) crm[phone].visits.push(v);
              });
              delete crm[k];
            }
          });
        }
        crm[phone].visits = crm[phone].visits || [];
        // שמור שעה בזמן ישראל (UTC+3)
        const [yr,mo,dy] = (d.date||'').split('-').map(Number);
        const [hr,mn] = (d.time||'09:00').split(':').map(Number);
        const israelDate = new Date(Date.UTC(yr, mo-1, dy, hr-3, mn, 0));
        crm[phone].visits.push({
          date: israelDate.toISOString(),
          service: d.service || '',
          notes: d.notes || '',
          source: 'crm',
          status: 'scheduled'
        });
        crm[phone].lastSeen = new Date().toISOString();
        saveCRM(crm);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        // עדכון לג'ולייט
        if (client.info) {
          client.sendMessage(JULIET_NUMBER,
            `📅 *תור חדש נוסף ב-CRM!*\n\n👤 *${d.name || phone}*\n📞 ${phone}\n💇 ${d.service || '—'}\n🗓 ${d.date} ${d.time || ''}`
          ).catch(()=>{});
        }
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // ── עריכת תור קיים ──────────────────────────────────────────
  if (url.pathname === '/edit-appointment' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const crm = loadCRM();
        const phone = (d.phone || '').replace(/\D/g,'').replace(/^972/,'0');
        const idx = parseInt(d.visitIndex);
        if (crm[phone] && Array.isArray(crm[phone].visits) && crm[phone].visits[idx]) {
          const v = crm[phone].visits[idx];
          const [yr2,mo2,dy2] = (d.date||'').split('-').map(Number);
          const [hr2,mn2] = (d.time||'09:00').split(':').map(Number);
          v.date = new Date(Date.UTC(yr2, mo2-1, dy2, hr2-3, mn2, 0)).toISOString();
          if (d.service) v.service = d.service;
          if (d.notes !== undefined) v.notes = d.notes;
          if (d.name) crm[phone].name = d.name;
          saveCRM(crm);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // ── מחיקת תור ────────────────────────────────────────────────
  if (url.pathname === '/delete-appointment' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const crm = loadCRM();
        const phone = (d.phone || '').replace(/\D/g,'').replace(/^972/,'0');
        const idx = parseInt(d.visitIndex);
        if (crm[phone] && Array.isArray(crm[phone].visits) && !isNaN(idx)) {
          crm[phone].visits.splice(idx, 1);
          saveCRM(crm);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // ── שמירת הערה על לקוחה ──────────────────────────────────────
  if (url.pathname === '/save-note' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const crm = loadCRM();
        const phone = (d.phone || '').replace(/\D/g,'').replace(/^972/,'0');
        if (crm[phone]) {
          crm[phone].notes = d.notes;
          crm[phone].vip = d.vip || false;
          saveCRM(crm);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // ── סנכרון lee ידני ──────────────────────────────────────────
  if (url.pathname === '/sync-lee' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'sync started' }));
    leeSyncStatus = { running: true, lastRun: null, added: 0, total: 0, error: null };
    syncLeeCalendar().then(r => {
      const res = (r && typeof r === 'object') ? r : { added: r || 0, total: r || 0 };
      leeSyncStatus = { running: false, lastRun: new Date().toISOString(), added: res.added || 0, total: res.total || 0, error: null };
    }).catch(e => {
      leeSyncStatus = { running: false, lastRun: new Date().toISOString(), added: 0, total: 0, error: e.message };
      console.log('sync-lee error:', e.message);
    });
    return;
  }

  // ── סטטוס סנכרון lee ──────────────────────────────────────────
  if (url.pathname === '/sync-lee-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const hasCredentials = !!(process.env.LEE_API_KEY || (process.env.LEE_EMAIL && process.env.LEE_PASS));
    res.end(JSON.stringify({ ...leeSyncStatus, hasCredentials }));
    return;
  }

  // ── גיבוי ידני ל-GitHub ───────────────────────────────────────
  if (url.pathname === '/backup-now' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('Unauthorized'); return; }
    res.writeHead(200, {'Content-Type':'application/json'});
    const crm = loadCRM();
    const count = Object.keys(crm).length;
    backupToGithub().then(() => {
      res.end(JSON.stringify({ ok: true, count, lastBackup: lastGithubBackupDate, message: `גיבוי הופעל — ${count} לקוחות` }));
    }).catch(e => {
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }

  // ── סטטוס גיבוי ──────────────────────────────────────────────
  if (url.pathname === '/backup-status') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('Unauthorized'); return; }
    const crm = loadCRM();
    const hasToken = !!process.env.GITHUB_TOKEN;
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      githubToken: hasToken,
      lastBackup: lastGithubBackupDate || 'לא גובה עדיין',
      customers: Object.keys(crm).length
    }));
    return;
  }

  // ── סטטוס תזכורות מחר ─────────────────────────────────────────
  if (url.pathname === '/reminder-status') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('Unauthorized'); return; }
    const crm = loadCRM();
    const tomorrowKey = getIsraelTomorrowKey();
    const israelHour = getIsraelHour();
    const pending = [], sent = [], leeSkipped = [];
    Object.entries(crm).forEach(([phone, c]) => {
      (c.visits||[]).forEach(v => {
        if (!v.date) return;
        const vd = new Date(new Date(v.date).toLocaleString('en-US',{timeZone:'Asia/Jerusalem'}));
        const vKey = `${vd.getFullYear()}-${String(vd.getMonth()+1).padStart(2,'0')}-${String(vd.getDate()).padStart(2,'0')}`;
        if (vKey !== tomorrowKey) return;
        const entry = { name: c.name, phone, time: vd.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}), service: v.service, reminderSent: !!v.reminderSent };
        if (phone.startsWith('lee_')) leeSkipped.push(entry);
        else if (v.reminderSent) sent.push(entry);
        else pending.push(entry);
      });
    });
    res.writeHead(200, {'Content-Type':'application/json;charset=utf-8'});
    res.end(JSON.stringify({ tomorrowKey, israelHour, pending, sent, leeSkipped }));
    return;
  }

  // ── ניקוי תורים שגויים מ-Lee ──────────────────────────────────
  if (url.pathname === '/clear-lee-data' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    const crm = loadCRM();
    let cleared = 0;
    Object.keys(crm).forEach(phone => {
      const c = crm[phone];
      const before = (c.visits || []).length;
      // מחק תורים עתידיים מ-Lee עם סטטוס scheduled
      c.visits = (c.visits || []).filter(v => {
        const isFutureLee = v.source === 'lee' && v.status === 'scheduled'
          && new Date(v.date).getTime() > Date.now() - 24*60*60*1000;
        if (isFutureLee) cleared++;
        return !isFutureLee;
      });
      // נקה pendingAppointment אם מקורו Lee
      if (c.pendingAppointmentSource === 'lee') {
        delete c.pendingAppointment;
        delete c.pendingAppointmentSource;
      }
    });
    saveCRM(crm);
    console.log(`🗑️ נוקו ${cleared} תורים שגויים מ-Lee`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, cleared }));
    return;
  }

  // ── שמירת תזכורת אישית ──────────────────────────────────────
  if (url.pathname === '/save-reminder' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const reminders = loadReminders();
        const id = Date.now().toString();
        reminders.push({ id, text: d.text, datetime: d.datetime, phone: d.phone||'', sent: false, created: new Date().toISOString() });
        saveReminders(reminders);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true, id }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // ── קבלת תזכורות ──────────────────────────────────────────
  if (url.pathname === '/get-reminders') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('[]'); return; }
    const reminders = loadReminders();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(reminders));
    return;
  }

  // ── מחיקת תזכורת ──────────────────────────────────────────
  if (url.pathname === '/delete-reminder' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        let reminders = loadReminders();
        reminders = reminders.filter(r => r.id !== d.id);
        saveReminders(reminders);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // כתובת טונל נוכחית
  if (url.pathname === '/tunnel') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const crmUrl = publicTunnelUrl ? publicTunnelUrl + '/crm?pass=juliet2026' : 'ממתין לטונל...';
    res.end(`<html dir="rtl"><body style="background:#0a0a0a;color:#e0d5c0;font-family:Arial;padding:30px;direction:rtl">
      <h2 style="color:#c8a84b">🌐 Cloudflare Tunnel</h2>
      <p style="margin:10px 0">סטטוס: ${publicTunnelUrl ? '✅ פעיל' : '⏳ מתחבר...'}</p>
      <p style="margin:10px 0;font-size:13px;color:#5e5c58">כתובת CRM:</p>
      <div style="background:#111;border:1px solid #c8a84b;border-radius:6px;padding:12px;font-size:14px;word-break:break-all;direction:ltr">${crmUrl}</div>
      <button onclick="navigator.clipboard.writeText('${crmUrl}');this.textContent='✅ הועתק!'"
        style="margin-top:12px;background:rgba(200,168,75,.2);border:1px solid #c8a84b;color:#c8a84b;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px">
        📋 העתק כתובת
      </button>
      <script>setTimeout(()=>location.reload(),10000)</script>
    </body></html>`);
    return;
  }

  // ── שמירת תמונה לפני/אחרי ──────────────────────────────────
  if (url.pathname === '/save-photo' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const phone = (d.phone || '').replace(/\D/g,'').replace(/^972/,'0');
        const type = d.type === 'after' ? 'after' : 'before';
        const dataUrl = d.data || '';
        if (!phone || !dataUrl) { res.writeHead(400); res.end('{}'); return; }

        // Extract base64 data
        const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) { res.writeHead(400); res.end('{}'); return; }
        const ext = matches[1].split('/')[1] || 'jpg';
        const base64Data = matches[2];

        // Create photos directory
        const photosDir = IS_RAILWAY ? '/data/photos' : path.join(__dirname, 'data', 'photos');
        if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

        const filename = `${phone}_${type}.${ext}`;
        const filepath = path.join(photosDir, filename);
        fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

        // Save URL reference in CRM
        const crm = loadCRM();
        if (!crm[phone]) crm[phone] = { phone, firstContact: new Date().toISOString(), visits: [] };
        if (!crm[phone].photos) crm[phone].photos = {};
        const photoUrl = `/get-photo?phone=${phone}&type=${type}&pass=${pass}`;
        crm[phone].photos[type] = photoUrl;
        saveCRM(crm);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: photoUrl }));
      } catch(e) {
        console.log('save-photo error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ── קבלת תמונה לפני/אחרי ──────────────────────────────────
  if (url.pathname === '/get-photo') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('Unauthorized'); return; }
    const phone = (url.searchParams.get('phone') || '').replace(/\D/g,'').replace(/^972/,'0');
    const type = url.searchParams.get('type') === 'after' ? 'after' : 'before';
    if (!phone) { res.writeHead(400); res.end(''); return; }

    const photosDir = IS_RAILWAY ? '/data/photos' : path.join(__dirname, 'data', 'photos');
    // Try common extensions
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      const filepath = path.join(photosDir, `${phone}_${type}.${ext}`);
      if (fs.existsSync(filepath)) {
        const contentTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'image/jpeg' });
        res.end(fs.readFileSync(filepath));
        return;
      }
    }
    res.writeHead(404); res.end('Not found');
    return;
  }

  // ── שליחת הודעה קבוצתית ─────────────────────────────────────
  if (url.pathname === '/send-bulk' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);
        const phones = Array.isArray(d.phones) ? d.phones : [];
        const message = d.message || '';
        if (!message || phones.length === 0) {
          res.writeHead(400); res.end(JSON.stringify({ sent: 0, failed: 0 })); return;
        }
        let sent = 0, failed = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Send in background after responding
        const doSend = async () => {
          for (const phone of phones) {
            try {
              const waId = '972' + phone.replace(/^0/, '') + '@c.us';
              await client.sendMessage(waId, message);
              sent++;
            } catch(e) {
              console.log(`bulk send failed for ${phone}:`, e.message);
              failed++;
            }
            await new Promise(r => setTimeout(r, 1500));
          }
          console.log(`✅ bulk send done — sent:${sent} failed:${failed}`);
        };
        res.end(JSON.stringify({ sent: phones.length, failed: 0, queued: true }));
        doSend();
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ sent: 0, failed: 0, error: e.message }));
      }
    });
    return;
  }

  // ── רשימת המתנה ──────────────────────────────────────────────
  const WAITLIST_FILE = IS_RAILWAY ? '/data/waitlist.json' : path.join(__dirname, 'waitlist.json');
  function loadWaitlist() {
    if (!fs.existsSync(WAITLIST_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8')); } catch(e) { return []; }
  }
  function saveWaitlist(data) { fs.writeFileSync(WAITLIST_FILE, JSON.stringify(data, null, 2)); }

  if (url.pathname === '/waitlist') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('[]'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadWaitlist()));
    return;
  }

  if (url.pathname === '/add-waitlist' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const list = loadWaitlist();
        const id = Date.now().toString();
        list.push({
          id,
          name: d.name || '',
          phone: (d.phone || '').replace(/\D/g,'').replace(/^972/,'0'),
          service: d.service || '',
          preferredDay: d.preferredDay || '',
          notes: d.notes || '',
          createdAt: new Date().toISOString()
        });
        saveWaitlist(list);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  if (url.pathname === '/remove-waitlist' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        let list = loadWaitlist();
        list = list.filter(i => i.id !== d.id);
        saveWaitlist(list);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  if (url.pathname === '/notify-waitlist' && req.method === 'POST') {
    const pass = url.searchParams.get('pass');
    if (pass !== CRM_PASS) { res.writeHead(401); res.end('{}'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const d = JSON.parse(body);
        const list = loadWaitlist();
        const item = list.find(i => i.id === d.id);
        if (!item) { res.writeHead(404); res.end('{}'); return; }
        const message = d.message || `היי ${item.name}! פנה מקום ב-Juliet Beauty Boutique 💎 רוצה לתאם תור? כתבי לי 🙏`;
        const waId = '972' + item.phone.replace(/^0/, '') + '@c.us';
        try {
          await client.sendMessage(waId, message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch(e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: e.message }));
        }
      } catch(e) { res.writeHead(500); res.end('{}'); }
    });
    return;
  }

  // בדיקת חיים
  res.writeHead(200);
  res.end('Juliet Bot is running 💎');
}).listen(process.env.PORT || 3000);

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'juliet-menu-bot',
    dataPath: IS_RAILWAY ? '/data/.wwebjs_auth' : undefined
  }),
  puppeteer: {
    headless: true,
    protocolTimeout: 120000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking'
    ]
  },
  webVersionCache: { type: 'none' },
  markOnlineOnConnect: false,
  restartOnAuthFail: true,
  bypassCSP: false
});

// ── State ──────────────────────────────────────────────────
const userState = {};

// ── תפריטים ───────────────────────────────────────────────
const MAIN_MENU = `היי! 💎 אני ג'ולייט —
מעצבת שיער ויוצרת AI מישראל ✨

*במה אוכל לעזור לך?* 👇

1️⃣ שירותי AI — אתר / בוט / סרטון לעסק
2️⃣ Juliet Beauty — טיפולי שיער
3️⃣ שאלות נפוצות
4️⃣ לדבר ישירות עם יוליה

_כתבי מספר ואני כאן_ 😊`;

const AI_MENU = `אני לא רק עושה שיער — אני בונה עסקים 🤖💎

בניתי את הבוט הזה בעצמי, עיצבתי את האתר שלי, ויצרתי תוכן AI שמביא לקוחות אמיתיות.

*את רוצה שאעשה את זה גם לעסק שלך?*

1️⃣ אתר / דף נחיתה — החל מ-₪1,499
2️⃣ אתר + בוט וואטסאפ — ₪2,999
3️⃣ VIP מלא — ₪4,900
4️⃣ סרטון AI לעסק (מ-₪590)
5️⃣ לא בטוחה? — אני אעזרי לבחור
6️⃣ חזרה

_כתבי מספר_ 😊`;

const BEAUTY_MENU = `💆‍♀️ *Juliet Beauty Boutique* 💎

מה מעניין אותך?

1️⃣ החלקות אורגניות OXO
2️⃣ תוספות שיער
3️⃣ צבע והייליטס
4️⃣ קטלוג שירותים ומחירים
5️⃣ חזרה לתפריט ראשי`;

const STRAIGHTENING_MENU = `💆‍♀️ *החלקה אורגנית OXO — Juliet Beauty* 💎

בחרי מה תרצי לדעת:

1️⃣ מה זה OXO? — הסבר מלא
2️⃣ היתרונות — למה זה שונה מהכל
3️⃣ שאלות נפוצות
4️⃣ מחירים
5️⃣ לראות עבודות — אינסטגרם
6️⃣ חזרה לתפריט`;

const STRAIGHTENING_ANSWERS = {
  '1': `💆‍♀️ *מה זה החלקה אורגנית OXO?* 💎

שלום! אני יוליה — מעצבת שיער ומאסטרית בהחלקות כבר *12 שנים* 🙏

*OXO Organic* היא החלקה שמשנה את *מבנה השיער לצמיתות* —
מה שהוחלק, נשאר חלק לתמיד!

🔄 *חידוש שורשים בלבד* — בדרך כלל כל *6-8 חודשים*
_(כלומר: משלמת פעם אחת על המלאה, ואחר כך רק על השורשים)_

✅ *מאושרת FDA, האיגוד האירופאי ומשרד הבריאות*
✅ *ללא פורמלין* — החלקה בריאה לחלוטין!
✅ *לא נמרחת ישירות על הקרקפת* — לא גורמת לנשירה ושבירה
✅ יש *אחריות מלאה* על תוצאות ההחלקה

📖 לקרוא עוד על ההחלקה:
https://juliet-beauty-boutique.netlify.app`,

  '2': `✨ *למה OXO שונה מכל החלקה אחרת?* 💎

אחרי OXO — *אין שום הגבלות!*

🧴 *כל שמפו* — לא צריך שמפו ללא סולפט
🎨 *צביעה מיד* — ניתן לצבוע בתום ההחלקה, ללא המתנה
🏊‍♀️ *ים ובריכה* — כבר באותו היום!
💨 *ללא פן* — לאחר מקלחת פשוט להסתרק — השיער מתייבש חלק
🤰 *בנות צעירות ונשים בהריון* — יכולות לעשות!

🔬 *למה זה בטוח?*
ההחלקה נחפצת בשמפו ביסודיות לפחות פעמיים לפני תחילת העבודה —
דבר שמונע פליטת עשן סמיך ואדים רעילים

💎 בקיצור — את מקבלת שיער חלק, בריא ויפה, בלי להוותר על כלום!`,

  '3': `❓ *שאלות נפוצות — החלקה OXO* 💎

*ש: כמה זמן מחזיק הטיפול?*
✅ ההחלקה היא לצמיתות! מחדשים רק שורשים כל 6-8 חודשים

*ש: צריך שמפו מיוחד אחרי?*
✅ לא! אפשר כל שמפו רגיל

*ש: מתי אפשר לשחות אחרי הטיפול?*
✅ כבר באותו יום!

*ש: מתי אפשר לצבוע?*
✅ ישר בתום ההחלקה — ללא המתנה

*ש: האם זה מתאים לשיער צבוע / פגום?*
✅ כן, ויוליה תבדוק את מצב השיער לפני ותתאים את הטיפול

*ש: האם נשים בהריון יכולות?*
✅ כן! ההחלקה בטוחה ומאושרת משרד הבריאות

📸 שאלה נוספת? שלחי הודעה ויוליה תענה אישית 💎`,

  '4': `💰 *מחירי החלקה OXO — Juliet Beauty* 💎

• *חידוש שורשים* (עד 12 ס"מ) — *850 ₪*
• *החלקה מלאה* — החל מ-*1,000 ₪*
  _(המחיר הסופי לפי אורך ועובי השיער)_

📸 *לקבלת מחיר מדויק — שלחי תמונה של השיער שלך!*
יוליה תענה עם מחיר מותאם אישית 🙏

🗓️ *הטיפולים בתיאום מראש בלבד*
_(ללא שבת)_`,

  '5': `📸 *עבודות של יוליה — Juliet Beauty Boutique*

לראות תוצאות אמיתיות של לקוחות:
👇
https://instagram.com/juliet_beauty_boutique

מוזמנת להתרשם מהעבודות 💎`
};

const FAQ_MENU = `❓ *שאלות נפוצות — Juliet Beauty*

בחרי מספר:

1️⃣ כמה עולה החלקה אורגנית?
2️⃣ כמה זמן מחזיק הטיפול?
3️⃣ האם צריך שמפו ללא סולפט אחרי OXO?
4️⃣ כמה עולות תוספות שיער?
5️⃣ שאלה אחרת — דברי עם ג'ולייט
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
  '1': `💰 *מחירי החלקה אורגנית OXO:*

• *חידוש שורשים* (עד 12 ס"מ) — *850 ₪*
• *החלקה מלאה* — החל מ-*1,000 ₪*
  _(לפי אורך ועובי השיער)_

📸 שלחי תמונה ואשלח מחיר מדויק!

✅ ללא פורמלין | מאושר FDA ומשרד הבריאות
🗓️ בתיאום מראש בלבד · ללא שבת`,

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

ג'ולייט תחזור אליך אישית בהקדם! 🙏

📸 אינסטגרם: @juliet_beauty_boutique
🌐 אתר: https://juliet-beauty-boutique.netlify.app/`
};

const AI_ANSWERS = {
  '1': {
    service: 'אתר / דף נחיתה',
    msg: `💻 *אתר / דף נחיתה — החל מ-₪1,499*

את יודעת כמה לקוחות מחפשות אותך ולא מוצאות? 😔

אני בונה לך דף שמדבר בשפה שלך, ממיר מבקרים ללקוחות ומביא אותן ישירות לוואטסאפ שלך.

*הבסיס כולל:*
✅ עיצוב אישי למותג שלך
✅ מותאם מובייל 100%
✅ כפתור וואטסאפ בולט
✅ קופי שיווקי שמוכר
✅ SEO בסיסי + העלאה לאוויר

*שדרוגים בתוספת תשלום:*
➕ בוט וואטסאפ חכם 24/7
➕ תוכן AI חודשי
➕ סרטון AI לעסק
➕ מערכת לידים + CRM
➕ ליווי VIP חודשי

_תשלום חד פעמי · ללא הפתעות_

רוצה שאחזור אלייך? כתבי *כן* 💎`
  },
  '2': {
    service: 'אתר + בוט וואטסאפ',
    msg: `🤖 *אתר + בוט וואטסאפ — ₪2,999*

זו בדיוק החבילה שיש לי — ואני חיה ממנה 😊

הלקוחות שלי מקבלות מענה גם בלילה, גם בשבת, גם כשאני אצל לקוחה. הבוט עובד בשבילי 24/7.

✅ אתר מקצועי + דף נחיתה
✅ בוט וואטסאפ חכם שמדבר כמוך
✅ תפריט שירותים אוטומטי
✅ קביעת תורים אוטומטית
✅ ניהול לידים + CRM
✅ ליווי אישי שבועיים ממני

*שדרוגים בתוספת תשלום:*
➕ תוכן AI חודשי
➕ סרטון AI לעסק
➕ ליווי VIP חודשי

_הכי משתלם · ROI מובטח_

רוצה שאחזור אלייך? כתבי *כן* 💎`
  },
  '3': {
    service: 'VIP מלא',
    msg: `👑 *VIP מלא — ₪4,900*

בשבילך שרוצה להפוך את העסק למכונה שעובדת לבד 🔥

זה מה שאני בונה לעצמי — ועכשיו אני בונה את זה גם לך.

✅ הכל בחבילה הקודמת +
✅ ליווי אישי חודש שלם
✅ אוטומציות מתקדמות
✅ תוכן AI — 3 חודשים
✅ אסטרטגיה שיווקית מלאה
✅ דו"ח ביצועים כל חודש
✅ עדיפות מענה 24 שעות ממני

רוצה שאחזור אלייך? כתבי *כן* 💎`
  },
  '4': {
    service: 'סרטון AI',
    msg: `🎬 *סרטון AI לעסק — מ-₪590*

ראית את הסרטונים שלי? יצרתי אותם עם AI 🎵
עכשיו אני עושה את זה לעסקים אחרים.

🔹 סרטון עד 30 שניות — *₪590*
🔹 סרטון עד דקה — *₪800*
_(עד 2 תיקונים כלולים)_

✨ *Pro* — 3 סרטונים בחודש — *₪1,990*
👑 *Studio VIP* — 5 סרטונים בחודש — *₪3,490*

רוצה שאחזור אלייך? כתבי *כן* 💎`
  },
  '5': {
    service: 'ייעוץ חינמי',
    msg: `💎 לא בטוחה מה מתאים לך? זה בסדר גמור 😊

תני לי 10 דקות ואני אגידי לך בדיוק מה העסק שלך צריך — *בחינם*, בלי שום מחויבות.

כתבי *"רוצה"* ואחזור אלייך בהקדם 💫`
  }
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

📸 שלחי תמונה של השיער שלך ואעזור לך לבחור את השיטה המתאימה 💎

📅 רוצה לקבוע תור? כתבי *"קביעה"* 😊`,

  '3': `🎨 *צבע והייליטס — Juliet Beauty*

✅ הייליטס
✅ בלייץ' מלא או חלקי
✅ אומברה / בלנדז'
✅ צבע מלא

📸 שלחי תמונה עם ההשראה שלך ואחזור אליך עם מחיר מותאם 💎

📅 רוצה לקבוע תור? כתבי *"קביעה"* 😊`
};

// ── פרטי הסלון ──────────────────────────────────────────────
const SALON_ADDRESS = `הציונות 61 דירה 14, אשדוד\n📞 *יש להתקשר אלי לפתיחת המחסום לפני ההגעה*\n🔑 קוד בניין: *0965*\n🚪 דלת זכוכית ודלת לבנה — קוד: *1998* ⭐ (כוכבית בסוף)`;
const GOOGLE_REVIEW_LINK = 'https://g.page/r/CYKHuv_GXpMfEAE/review';
const FACEBOOK_REVIEW_LINK = 'https://www.facebook.com/juliet.beauty.boutique/';

// ── טיימרים להצעה מיוחדת (יום שלם ללא מענה) ──────────────
const pendingOffers = {};

// ── עזר: שעה נוכחית ישראל ──────────────────────────────────
function getIsraelHour() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }) * 1;
}

// ── זיהוי לקוח מרחוק (שם מכיל שם עיר) ──────────────────────
const CITY_KEYWORDS = ['ת"א','תל אביב','הרצליה','הרגליה','ראשל"צ','ראשלצ','ראשון לציון','נתניה','רמת גן','גבעתיים','פ"ת','פתח תקווה','חולון','בת ים','רחובות','רעננה','כפר סבא','הוד השרון','ירושלים','י"ם','חיפה','באר שבע','נס ציונה','יבנה','מודיעין','לוד','רמלה','קריית גת','אשקלון','גבעת שמואל','פ"ת','קרית אונו','אור יהודה','בני ברק'];

function hasCity(name) {
  if (!name) return false;
  return CITY_KEYWORDS.some(city => name.includes(city));
}

// ── תאריך מחר ב-Israel time (YYYY-MM-DD) ──────────────────
function getIsraelTomorrowKey() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getIsraelTodayKey() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── ברכה לפי שעה ──────────────────────────────────────────────
function getGreeting() {
  const h = getIsraelHour();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 21) return 'ערב טוב';
  return 'לילה טוב';
}

// ── תגובות מגוונות (רנדומלי) ──────────────────────────────────
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
const WARM_REPLIES = [
  'בהחלט! 💎',
  'כמובן! 🤍',
  'שמחה לעזור! 😊',
  'בשמחה! ✨'
];
const BOOKING_INTROS = [
  'מעולה! בואי נמצא לך זמן נוח 📅',
  'יופי! נסדר לך תור 💎',
  'כיף! בואי נקבע 😊'
];

// ── חישוב 5 ימים קרובים ─────────────────────────────────────
const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function getNextDays() {
  const days = [];
  const today = new Date();
  let i = 1;
  while (days.length < 6) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    i++;
    if (d.getDay() === 6) continue; // ✅ דלג על שבת
    const dayName = DAYS_HE[d.getDay()];
    const dateStr = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    days.push({ label: `יום ${dayName} ${dateStr}`, date: d.toISOString() });
  }
  return days;
}

// ── תפריט רוסי ───────────────────────────────────────────────
const MAIN_MENU_RU = `Привет! 💎 Я Юлия —
парикмахер и AI-создатель из Израиля ✨

*Чем могу помочь?* 👇

1️⃣ AI-услуги — сайт / бот / видео для бизнеса
2️⃣ Juliet Beauty — уход за волосами
3️⃣ Часто задаваемые вопросы
4️⃣ Написать напрямую Юле

_Напишите цифру_ 😊`;

const BEAUTY_MENU_RU = `💆‍♀️ *Juliet Beauty Boutique* 💎

Что вас интересует?

1️⃣ Органическое выпрямление OXO
2️⃣ Наращивание волос
3️⃣ Окрашивание и хайлайтс
4️⃣ Каталог услуг и цены
5️⃣ Назад в главное меню`;

function isRussian(text) {
  return /[а-яёА-ЯЁ]/.test(text);
}

// ── הודעת מחיר משכנעת ללקוחה ──────────────────────────────
function buildPriceMessage(name, service, price) {
  const priceStr = price.toString().replace(/[₪\s]/g,'');
  const isRoots = parseInt(priceStr) <= 900;
  return (
    `היי${name ? ' ' + name : ''}! 💎\n\n` +
    `בדקתי את השיער שלך אישית — ואני יודעת *בדיוק* מה הוא צריך 🌿\n\n` +
    `תחשבי רגע:\n` +
    `כמה זמן את מבלה כל בוקר עם הפן? ⏱️\n` +
    `כמה פעמים הלחות הרסה לך את היום? ☁️\n` +
    `כמה כסף הוצאת על מוצרים שרק מבטיחים? 😔\n\n` +
    `*עם OXO — זה משתנה, פעם אחת ולתמיד:*\n\n` +
    `🌅 *קמה בבוקר עם שיער חלק ומושלם* — גם בלי פן, גם בלחות\n` +
    `🏊‍♀️ *ים, בריכה, גשם* — תתרחצי, השיער נשאר חלק כמו ביום הטיפול\n` +
    `⚡ *אין המתנה* — ציפוי, שחייה ושמפו רגיל כבר באותו יום!\n` +
    `💚 *ללא פורמלין* — בטוח לחלוטין, גם בהריון ולאמהות מניקות\n` +
    `♾️ *לצמיתות* — מה שהוחלק לא יחזור. רק שורשים כל 6-8 חודשים\n` +
    `🎨 *לצבוע? להייליטס?* — אפשר מיד אחרי, אין הגבלה\n` +
    `🏅 *מאושר FDA, האיגוד האירופאי ומשרד הבריאות*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *המחיר המותאם אישית לשיער שלך:*\n` +
    `🔹 *₪${priceStr}*${isRoots ? ' _(חידוש שורשים)_' : ''}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⏰ *התורים מתמלאים מהר* — תשריני מקום עכשיו!\n\n` +
    `📅 כתבי *"קביעה"* ואסדר לך תאריך 💎\n\n` +
    `📸 ראי תוצאות אמיתיות של לקוחות:\n` +
    `👉 @juliet_beauty_boutique\n\n` +
    `🌐 לכל הפרטים והמחירים:\n` +
    `https://juliet-beauty-boutique.netlify.app/?utm_source=ig&utm_medium=social&utm_content=link_in_bio\n\n` +
    `_את תאהבי את התוצאה — ג'ולייט מבטיחה_ 🤍`
  );
}

// ── שליחת התראת מחיר לג'ולייט ──────────────────────────────
async function notifyPriceRequest(from, name, service) {
  const cleanPhone = from.replace('@c.us','').replace('972','0');
  try {
    const crm = loadCRM();
    if (crm[cleanPhone]) {
      crm[cleanPhone].pendingPriceRequest = { date: new Date().toISOString(), service, customerPhone: cleanPhone, customerName: name || '' };
      saveCRM(crm);
    }
    await client.sendMessage(JULIET_NUMBER,
      `💰 *לקוחה שואלת על מחיר!*\n\n` +
      `👤 *${name || 'לקוחה'}* — ${cleanPhone}\n` +
      `💇 שירות: *${service}*\n\n` +
      `💬 *כדי לשלוח לה מחיר — כתבי:*\n` +
      `\`מחיר ${cleanPhone} 1200\`\n` +
      `_(רק את הסכום, הבוט ישלח הכל אוטומטית)_ 📤`
    );
  } catch(e) {}
}

// ── מילות פתיחה ─────────────────────────────────────────────
const GREETINGS = ['היי', 'הי', 'שלום', 'בוקר טוב', 'ערב טוב', 'תפריט', 'menu', 'התחל', 'start', 'hello', 'hi', '0', 'привет', 'здравствуй', 'добрый', 'начать'];

// ── מספר ג'ולייט ────────────────────────────────────────────
const JULIET_NUMBER = '972586210365@c.us';
let JULIET_LID = null; // LID דינמי — נלמד בזמן ריצה
const pendingJulietQuestions = new Map(); // to → { name, cleanPhone, time } — שאלות ממתינות ללקוחות

function isJulietNumber(id) {
  if (!id) return false;
  if (id === JULIET_NUMBER) return true;
  if (JULIET_LID && id === JULIET_LID) return true;
  return false;
}

// ── שעות פעילות ─────────────────────────────────────────────
const OPEN_HOUR = 9;   // פותחים ב-9:00
const CLOSE_HOUR = 22; // סוגרים ב-22:00

// ── מצב היעדרות ─────────────────────────────────────────────
let isAbsent = false;
let absentMessage = '';

// ── פקודות ג'ולייט לאישור/ביטול תורים ───────────────────────
async function handleJulietCommand(message) {
  const body = message.body.trim();
  const bodyLow = body.toLowerCase();

  // ── בדיקת תפריט לקוחה (סימולציה) ──────────────────────────
  if (bodyLow === 'בדיקה' || bodyLow === 'תפריט לקוחה' || bodyLow === 'תצוגה') {
    await message.reply(`🔍 *כך רואה לקוחה חדשה:*\n\n${MAIN_MENU}`);
    return;
  }

  // ── היעדרות ─────────────────────────────────────────────
  if (body.startsWith('היעדרות פתח')) {
    const reason = body.replace('היעדרות פתח', '').trim();
    isAbsent = true;
    absentMessage = reason || 'אני כרגע לא זמינה — אחזור אלייך בהקדם! 🤍';
    await message.reply(`✅ מצב היעדרות *פעיל*\n\nהודעה ללקוחות:\n"${absentMessage}"`);
    return;
  }
  if (bodyLow === 'היעדרות סגור' || bodyLow === 'חזרתי') {
    isAbsent = false;
    absentMessage = '';
    await message.reply(`✅ מצב היעדרות *כובה* — הבוט חזר לפעילות רגילה 💎`);
    return;
  }
  if (bodyLow === 'היעדרות') {
    await message.reply(
      `📴 *פקודות היעדרות:*\n\n` +
      `• \`היעדרות פתח\` — הפעילי היעדרות (עם הודעה כללית)\n` +
      `• \`היעדרות פתח אני בחופש עד יום ב\` — עם הודעה אישית\n` +
      `• \`היעדרות סגור\` / \`חזרתי\` — כיבוי\n\n` +
      `סטטוס נוכחי: ${isAbsent ? `🔴 פעיל — "${absentMessage}"` : '🟢 כבוי'}`
    );
    return;
  }

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

  // ── סטטיסטיקה ───────────────────────────────────────────
  if (bodyLow.startsWith('סטטיסטיקה') || bodyLow === 'stats') {
    const crm = loadCRM();
    const all = Object.values(crm);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const newWeek = all.filter(c => c.firstContact && new Date(c.firstContact).getTime() > weekAgo).length;
    const newMonth = all.filter(c => c.firstContact && new Date(c.firstContact).getTime() > monthAgo).length;
    const withAppt = all.filter(c => c.pendingAppointment).length;
    const withPhoto = all.filter(c => c.lastPhotoSent).length;
    const services = {};
    all.forEach(c => { if (c.lastService) services[c.lastService] = (services[c.lastService] || 0) + 1; });
    const topService = Object.entries(services).sort((a,b) => b[1]-a[1])[0];
    const available = getAvailableSlots();
    await message.reply(
      `📊 *סטטיסטיקה — Juliet Beauty* 💎\n\n` +
      `👥 סה"כ לקוחות: *${all.length}*\n` +
      `🆕 חדשות השבוע: *${newWeek}*\n` +
      `📅 חדשות החודש: *${newMonth}*\n` +
      `🗓️ תורים פעילים: *${withAppt}*\n` +
      `📸 שלחו תמונה: *${withPhoto}*\n` +
      `📅 תורים פנויים: *${available.length}*\n` +
      `${topService ? `\n🏆 שירות מבוקש: *${topService[0]}* (${topService[1]}x)` : ''}`
    );
    return;
  }

  // ── חיפוש לקוחה בCRM ────────────────────────────────────────
  // פורמט: "חפשי שרה" או "חפשי 054..."
  const searchMatch = body.match(/^חפש[יי]?\s+(.+)/);
  if (searchMatch) {
    const query = searchMatch[1].trim();
    const crm = loadCRM();
    const results = Object.entries(crm).filter(([phone, c]) =>
      phone.includes(query) || (c.name && c.name.includes(query))
    );
    if (!results.length) {
      await message.reply(`❌ לא נמצאה לקוחה עם "${query}"`);
    } else {
      const lines = results.slice(0, 5).map(([phone, c]) => {
        const appt = c.pendingAppointment
          ? `🗓️ תור: ${new Date(c.pendingAppointment).toLocaleString('he-IL', { timeZone:'Asia/Jerusalem', day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' })}`
          : `📅 אין תור פעיל`;
        const since = c.firstContact ? new Date(c.firstContact).toLocaleDateString('he-IL') : 'לא ידוע';
        return `👤 *${c.name || 'ללא שם'}*\n📞 ${phone}\n${appt}\n💇‍♀️ ${c.lastService || 'שירות לא ידוע'}\n📌 לקוחה מאז: ${since}`;
      });
      await message.reply(
        `🔍 *נמצאו ${results.length} תוצאות:*\n\n` + lines.join('\n\n─────────\n\n')
      );
    }
    return;
  }

  // פורמט: "אישרתי 0586210365 10:00" או "ביטלתי 0586210365"
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

  // ── השתקת לקוחה / ביטול ──────────────────────────────────
  // פורמט: "השתק 0521234567" / "בטל השתק 0521234567"
  const muteMatch   = body.match(/^השתק\s+(05\d{8})/);
  const unmuteMatch = body.match(/^בטל השתק\s+(05\d{8})/);
  if (muteMatch) {
    const phone = muteMatch[1];
    const crm = loadCRM();
    if (!crm[phone]) { await message.reply(`❌ לא נמצאה לקוחה ${phone}`); return; }
    crm[phone].muted = true;
    saveCRM(crm);
    await message.reply(`🔇 *${crm[phone].name || phone}* — הושתקה ✅\nלא תקבל הודעות אוטומטיות.\n\nלביטול: \`בטל השתק ${phone}\``);
    return;
  }
  if (unmuteMatch) {
    const phone = unmuteMatch[1];
    const crm = loadCRM();
    if (!crm[phone]) { await message.reply(`❌ לא נמצאה לקוחה ${phone}`); return; }
    crm[phone].muted = false;
    saveCRM(crm);
    await message.reply(`🔔 *${crm[phone].name || phone}* — ההשתקה בוטלה ✅\nתחזור לקבל הודעות אוטומטיות.`);
    return;
  }

  // ── שליחת תזכורות ידנית ──────────────────────────────────────
  // פקודה: "שלח תזכורות" — שולחת תזכורות לכל מי שיש לו תור מחר
  if (bodyLow === 'שלח תזכורות' || bodyLow === 'תזכורות מחר' || bodyLow === 'שלחי תזכורות') {
    const tomorrowKey = getIsraelTomorrowKey();
    const crm = loadCRM();
    let sent = 0, skipped = 0, errors = 0;
    const report = [];

    for (const [phone, customer] of Object.entries(crm)) {
      if (customer.muted) continue;
      if (!phone.startsWith('05') && !phone.match(/^[0-9]{10}$/)) continue; // רק מספרים אמיתיים

      const visits = (customer.visits || []).filter(v =>
        v.date && v.date.slice(0,10) === tomorrowKey && v.status !== 'cancelled' && v.status !== 'done'
      );
      if (!visits.length) continue;

      // קח את התור הראשון של מחר
      const visit = visits[0];
      const name = customer.name || 'יקרה';
      const firstName = name.split(' ')[0];
      const apptStr = new Date(visit.date).toLocaleTimeString('he-IL', { timeZone:'Asia/Jerusalem', hour:'2-digit', minute:'2-digit' });
      const chatId = '972' + phone.replace(/^0/,'') + '@c.us';

      let msg;
      if (hasCity(name)) {
        msg = `היי ${firstName}! 💎\n\n` +
          `תזכורת לתור מחר ב-*${apptStr}*${visit.service ? ` — *${visit.service}*` : ''} אצל *Juliet Beauty Boutique* 💇‍♀️\n\n` +
          `📍 *כתובת הסלון:*\n${SALON_ADDRESS}\n\n` +
          `✨ מכיוון שאת מגיעה מרחוק — תרצי לשלוח לי את הכתובת המדויקת שלך? אדאג שיהיה לך קל להגיע 📍\n\n` +
          `מחכה לך! 💫`;
      } else {
        msg = `היי ${firstName}! 💎\n\n` +
          `תזכורת לתור מחר ב-*${apptStr}*${visit.service ? ` — *${visit.service}*` : ''} אצל *Juliet Beauty Boutique* 💇‍♀️\n\n` +
          `📍 *כתובת:*\n${SALON_ADDRESS}\n\n` +
          `אם צריך לשנות — שלחי הודעה 🙏\nמחכה לך! 💫`;
      }

      try {
        await client.sendMessage(chatId, msg);
        visit.reminderSent = true;
        sent++;
        report.push(`✅ ${name} (${phone}) — ${apptStr}`);
        await new Promise(r => setTimeout(r, 1500)); // השהייה למניעת חסימה
      } catch(e) {
        errors++;
        report.push(`❌ ${name} (${phone}) — ${e.message}`);
      }
    }

    saveCRM(crm);

    const tomorrowDate = new Date(tomorrowKey).toLocaleDateString('he-IL', { day:'numeric', month:'numeric' });
    await message.reply(
      `📅 *תזכורות נשלחו ל-${tomorrowDate}*\n\n` +
      `✅ נשלח: *${sent}*\n` +
      (errors ? `❌ נכשל: *${errors}*\n` : '') +
      (skipped ? `⏭️ דולג (ללא מספר): *${skipped}*\n` : '') +
      (report.length ? `\n` + report.join('\n') : '')
    );
    return;
  }

  // ── ניקוי תורים שגויים מ-Lee ──────────────────────────────────
  if (bodyLow === 'נקה lee' || body === 'נקה CRM Lee' || body === 'נקה תורים lee') {
    const crm = loadCRM();
    let cleared = 0;
    Object.keys(crm).forEach(phone => {
      const c = crm[phone];
      c.visits = (c.visits || []).filter(v => {
        const isFutureLee = v.source === 'lee' && v.status === 'scheduled'
          && new Date(v.date).getTime() > Date.now() - 24*60*60*1000;
        if (isFutureLee) cleared++;
        return !isFutureLee;
      });
      if (c.pendingAppointmentSource === 'lee') {
        delete c.pendingAppointment;
        delete c.pendingAppointmentSource;
      }
    });
    saveCRM(crm);
    await message.reply(`🗑️ נוקו *${cleared}* תורים שגויים מ-Lee.\n\nהCRM נקי עכשיו 💎\nסנכרון מחדש מ-Lee יתבצע בכ-2 שעות, או שלחי \`סנכרן lee\` עכשיו.`);
    return;
  }

  // ── סנכרון ידני של Lee ───────────────────────────────────────
  if (bodyLow === 'סנכרן lee' || bodyLow === 'רענן lee') {
    await message.reply(`🔄 מסנכרן תורים מ-Lee... אחכה כמה שניות ✨`);
    try {
      const r = await syncLeeCalendar();
      const res = (r && typeof r === 'object') ? r : { added: r || 0, total: r || 0 };
      if (res.added > 0) {
        await message.reply(`✅ סנכרון Lee הסתיים!\n\n➕ נוספו *${res.added}* תורים חדשים\n📋 סה"כ ב-Lee: *${res.total}* תורים`);
      } else if (res.total > 0) {
        await message.reply(`✅ הכל מעודכן!\n\n📋 Lee: *${res.total}* תורים (הכל כבר ב-CRM)\n📅 היומן מציג את כולם 💎`);
      } else {
        await message.reply(`⚠️ Lee לא החזיר תורים.\nייתכן שה-API Key לא מאפשר גישה לתורים.\n\nתורים בCRM נשארים כפי שהם.`);
      }
    } catch(e) {
      await message.reply(`⚠️ שגיאה בסנכרון Lee: ${e.message}`);
    }
    return;
  }

  // ── הוספת תור ידנית ──────────────────────────────────────────
  // פורמט: "הוסף תור 0509876543 שרה 15/4 10:00 החלקה אורגנית"
  //        "הוסף תור 0509876543 שרה 2026-04-15 10:00 החלקה"
  const addApptMatch = body.match(/^הוסף תור\s+(05\d{8})\s+(\S+)\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(\d{1,2}:\d{2})\s*(.*)/);
  if (addApptMatch) {
    const [, phone, custName, datePart, timePart, service] = addApptMatch;
    // פרסור תאריך: "15/4" או "15/4/2026" או "15-4-2026"
    const parts = datePart.split(/[\/\-]/);
    const day   = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const year  = parts[2] ? (parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2])) : new Date().getFullYear();
    const [h, m] = timePart.split(':').map(Number);
    const apptDate = new Date(year, month, day, h, m, 0);
    if (isNaN(apptDate.getTime())) {
      await message.reply(`❌ תאריך לא תקין. נסי שוב:\n\`הוסף תור 0509876543 שרה 15/4 10:00 החלקה\``);
      return;
    }
    const iso = apptDate.toISOString();
    const crm = loadCRM();
    if (!crm[phone]) {
      crm[phone] = { phone, name: custName, firstContact: iso, visits: [], source: 'manual' };
    }
    if (custName && custName !== 'ללא') crm[phone].name = custName;
    crm[phone].visits = crm[phone].visits || [];
    crm[phone].pendingAppointment = iso;
    crm[phone].pendingAppointmentSource = 'manual';
    const svcStr = service.trim() || 'טיפול';
    if (!crm[phone].visits.some(v => v.date === iso)) {
      crm[phone].visits.push({ date: iso, service: svcStr, source: 'manual', status: 'scheduled' });
    }
    crm[phone].lastService = svcStr;
    saveCRM(crm);
    const dateStr = apptDate.toLocaleDateString('he-IL', { day:'numeric', month:'numeric', year:'numeric' });
    await message.reply(
      `✅ *תור נוסף!* 💎\n\n` +
      `👤 *${crm[phone].name || phone}*\n` +
      `📞 ${phone}\n` +
      `💇 ${svcStr}\n` +
      `🗓 ${dateStr} בשעה ${timePart}\n\n` +
      `נשמר ב-CRM ✅`
    );
    return;
  }

  if (body === 'הוסף תור' || body === 'תור חדש') {
    await message.reply(
      `📅 *הוספת תור ידנית*\n\n` +
      `שלחי בפורמט:\n` +
      `\`הוסף תור [טלפון] [שם] [תאריך] [שעה] [שירות]\`\n\n` +
      `דוגמה:\n` +
      `\`הוסף תור 0509876543 שרה 15/4 10:00 החלקה אורגנית\`\n\n` +
      `📌 תאריך בפורמט: יום/חודש (15/4) או יום/חודש/שנה (15/4/2026)`
    );
    return;
  }

  // ── שלחי הודעה ישירות ללקוחה ─────────────────────────────────
  // פורמט: "שלחי 0521234567 הטקסט כאן"
  const sendMatch = body.match(/^שלחי\s+(05\d{8})\s+([\s\S]+)/);
  if (sendMatch) {
    const phone = sendMatch[1];
    const text = sendMatch[2].trim();
    const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
    try {
      await client.sendMessage(chatId, text);
      await message.reply(`✅ נשלח ל-${phone}:\n"${text.slice(0,80)}${text.length>80?'...':''}"`);
    } catch(e) {
      await message.reply(`❌ שגיאה: ${e.message}`);
    }
    return;
  }

  // ── תאמי תור עם לקוחה ─────────────────────────────────────
  // פורמט: "תאמי 0521234567"
  const bookMatch = body.match(/^תאמי\s+(05\d{8})/);
  if (bookMatch) {
    const phone = bookMatch[1];
    const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
    const crm = loadCRM();
    const custName = (crm[phone] && crm[phone].name) || '';
    const available = getAvailableSlots();
    if (!available.length) {
      await message.reply(`⚠️ אין תורים פנויים — הוסיפי קודם עם:\n\`\`\`פנויים\nשישי 28/3 10:00\`\`\``);
      return;
    }
    const slotsText = available.slice(0,5).map((s,i) => `${i+1}. ${s.label}`).join('\n');
    try {
      await client.sendMessage(chatId,
        `היי${custName ? ' ' + custName : ''}! 💎\n\n` +
        `ג'ולייט רוצה לקבוע לך תור 🙏\n\n` +
        `📅 *הזמנים הפנויים הקרובים:*\n${slotsText}\n\n` +
        `כתבי מספר לבחור זמן 😊`
      );
      // שמור state לקביעת תור
      userState[chatId] = userState[chatId] || {};
      userState[chatId].step = 'booking_slots';
      userState[chatId].name = custName;
      await message.reply(`✅ שלחתי ל-${custName || phone} את הזמנים הפנויים 📅`);
    } catch(e) {
      await message.reply(`❌ שגיאה: ${e.message}`);
    }
    return;
  }

  // ── פקודת מחיר — שליחת פיץ' מלא + מחיר ללקוחה ────────────
  // פורמט: "מחיר 0586210365 1200" או "מחיר 0586210365 1200 החלקה מלאה"
  const priceMatch = body.match(/^מחיר\s+(05\d{8})\s+([\d₪]+)\s*(.*)/);
  if (priceMatch) {
    const phone = priceMatch[1];
    const price = priceMatch[2];
    const serviceOverride = priceMatch[3].trim();
    const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
    const crm = loadCRM();
    const custName = (crm[phone] && crm[phone].name) || '';
    // שירות: מהפקודה או מה-pendingPriceRequest בCRM
    const service = serviceOverride ||
      (crm[phone] && crm[phone].pendingPriceRequest && crm[phone].pendingPriceRequest.service) ||
      'החלקה אורגנית OXO';

    try {
      await client.sendMessage(chatId, buildPriceMessage(custName, service, price));
      // נקה pendingPriceRequest
      if (crm[phone] && crm[phone].pendingPriceRequest) {
        delete crm[phone].pendingPriceRequest;
        saveCRM(crm);
      }
      await message.reply(`✅ נשלח פיץ' מלא + מחיר ₪${price} ל-${custName || phone}! 💎`);
    } catch(e) {
      await message.reply(`❌ שגיאה בשליחה: ${e.message}`);
    }
    return;
  }

  // ── שידור — שליחה לכל הלקוחות ──────────────────────────────
  // פורמטים:
  //   "שידור: טקסט"              — כולן
  //   "שידור ימים 30: טקסט"      — רק לא-פעילות מעל 30 יום
  //   "שידור שירות החלקה: טקסט"  — לפי שירות אחרון
  if (body.startsWith('שידור:') || body.startsWith('שידור ')) {
    // זיהוי פילטר ימים
    const daysMatch = body.match(/^שידור\s+ימים\s+(\d+)[: ]+(.+)/s);
    const serviceMatch2 = body.match(/^שידור\s+שירות\s+([^:]+)[: ]+(.+)/s);
    let filterDesc = 'כולן';
    let text = body.replace(/^שידור[: ]+/, '').trim();
    let filterFn = () => true;

    if (daysMatch) {
      const days = parseInt(daysMatch[1]);
      text = daysMatch[2].trim();
      const cutoff = Date.now() - days * 24 * 3600000;
      filterFn = (c) => !c.lastSeen || new Date(c.lastSeen).getTime() < cutoff;
      filterDesc = `לא פעילות מעל ${days} יום`;
    } else if (serviceMatch2) {
      const svcFilter = serviceMatch2[1].trim().toLowerCase();
      text = serviceMatch2[2].trim();
      filterFn = (c) => c.lastService && c.lastService.toLowerCase().includes(svcFilter);
      filterDesc = `שירות "${serviceMatch2[1].trim()}"`;
    }

    if (!text) {
      await message.reply(`📢 *שידור להמוני*\n\nשלחי בפורמט:\n\`שידור: הטקסט שלך כאן\`\n\n_ההודעה תישלח לכל הלקוחות ב-CRM_`);
      return;
    }
    const crm = loadCRM();
    const allPhones = Object.entries(crm).filter(([,c]) => !c.muted && filterFn(c)).map(([p]) => p);
    let sent = 0, failed = 0;
    await message.reply(`📤 שולחת ל-*${allPhones.length}* לקוחות (${filterDesc})... ⏳`);
    for (const phone of allPhones) {
      try {
        const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
        const custName = crm[phone].name || '';
        await client.sendMessage(chatId,
          `${custName ? `${custName}, ` : ''}${text}\n\n_— Juliet Beauty 💎_`
        );
        sent++;
        await new Promise(r => setTimeout(r, 1500));
      } catch(e) { failed++; }
    }
    await message.reply(`✅ *שידור הושלם!*\n\n📤 נשלח: *${sent}*\n❌ נכשל: *${failed}*\n🎯 פילטר: ${filterDesc}`);
    return;
  }

  // ── עזרה — כל הפקודות ───────────────────────────────────
  if (bodyLow === 'עזרה' || bodyLow === 'help' || bodyLow === '?') {
    await message.reply(
      `💎 *פקודות מנהל — Juliet Bot*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

      `📅 *תורים פנויים לשבוע:*\n` +
      `\`\`\`פנויים\n` +
      `ראשון 6/4 10:00\n` +
      `ראשון 6/4 13:00\n` +
      `שלישי 8/4 11:00\n` +
      `שישי 11/4 09:00\`\`\`\n\n` +

      `✅ *אישור תור:*\n` +
      `\`אישרתי 05XXXXXXXX 10:00\`\n\n` +

      `❌ *ביטול תור:*\n` +
      `\`ביטלתי 05XXXXXXXX\`\n\n` +

      `🔍 *חיפוש לקוחה:*\n` +
      `\`חפשי שם\` או \`חפשי 05XXXXXXXX\`\n\n` +

      `📊 *סטטיסטיקה:*\n` +
      `\`סטטיסטיקה\`\n\n` +

      `👥 *רשימת לקוחות:*\n` +
      `\`לקוחות\`\n\n` +

      `📢 *שידור לכולן:*\n` +
      `\`שידור: הטקסט שלך כאן\`\n\n` +

      `📴 *היעדרות:*\n` +
      `\`היעדרות פתח\` / \`חזרתי\`\n\n` +

      `🔍 *בדיקת תפריט לקוחה:*\n` +
      `\`בדיקה\`\n\n` +

      `🔇 *השתקת לקוחה (ללא הודעות אוטו):*\n` +
      `\`השתק 05XXXXXXXX\`\n` +
      `\`בטל השתק 05XXXXXXXX\`\n\n` +

      `💬 *שלחי הודעה ישירות ללקוחה:*\n` +
      `\`שלחי 05XXXXXXXX הטקסט כאן\`\n\n` +

      `📅 *קבעי תור ללקוחה:*\n` +
      `\`תאמי 05XXXXXXXX\`\n\n` +

      `➕ *הוסף תור ידנית ל-CRM:*\n` +
      `\`הוסף תור 05XXXXXXXX שם 15/4 10:00 שירות\`\n\n` +

      `🔄 *סנכרון Lee:*\n` +
      `\`סנכרן lee\` — סנכרן עכשיו\n` +
      `\`נקה lee\` — מחק תורים שגויים מ-Lee\n\n` +

      `💰 *שלחי מחיר ללקוחה:*\n` +
      `\`מחיר 05XXXXXXXX 1200\`\n\n` +

      `📋 *CRM מלא:*\n` +
      `https://juliet-bot-production.up.railway.app/crm?pass=juliet2026`
    );
    return;
  }

  // הוראות שימוש אם ג'ולייט כתבה משהו לא מובן
  if (body.startsWith('אישרתי') || body.startsWith('ביטלתי')) {
    await message.reply(
      `💎 *פקודות לניהול תורים:*\n\n` +
      `✅ אישור: \`אישרתי 05XXXXXXXX HH:MM\`\n` +
      `❌ ביטול: \`ביטלתי 05XXXXXXXX\`\n\n` +
      `_דוגמה: אישרתי 0586210365 10:30_`
    );
  }
}

// ── פקודות ג'ולייט — הודעות שהיא שולחת לעצמה ──────────────
const ADMIN_KEYWORDS = ['פנויים','תורים','יומן','פנוי','נקה','אישרתי','ביטלתי','לקוחות','crm','סטטיסטיקה','עזרה','help','מחיר','שידור','חפשי','חפש','היעדרות','חזרתי','בדיקה','תפריט לקוחה','תצוגה','השתק','בטל השתק','שלחי','תאמי','הוסף תור','תור חדש','סנכרן lee','רענן lee','נקה lee','שלח תזכורות','תזכורות מחר','שלחי תזכורות'];

client.on('message_create', async (message) => {
  if (!message.fromMe) return;
  const from = message.from || '';
  const to = message.to || '';
  if (from === 'status@broadcast' || from.includes('broadcast') || from.endsWith('@g.us')) return;
  if (to.endsWith('@g.us')) return;
  if (message.isStatus) return;

  // ── לומד את ה-LID של ג'ולייט דינמית ─────────────────────────
  // from = המספר של ג'ולייט עצמה (המכשיר שולח)
  // to = הנמען (הלקוחה) — לא לשמור כ-LID!
  if (from && !from.endsWith('@g.us') && from !== 'status@broadcast' && !JULIET_LID) {
    JULIET_LID = from;
    console.log(`📱 למדתי LID של ג'ולייט: ${JULIET_LID}`);
  }

  // ── כשג'ולייט שולחת הודעה ללקוחה — שואל האם להמשיך ──────────
  const isSelfMsg = isJulietNumber(to);
  if (!isSelfMsg) {
    const crm = loadCRM();
    const cleanPhone = to.replace('@c.us','').replace('@lid','').replace(/^972/,'0');
    const customerName = (crm[cleanPhone] && crm[cleanPhone].name) || cleanPhone;
    // שלח שאלה לג'ולייט רק אם לא שאלנו כבר על הלקוחה הזו ב-30 דקות האחרונות
    const existing = pendingJulietQuestions.get(to);
    const alreadyAsked = existing && (Date.now() - existing.time < 30 * 60 * 1000);
    if (!alreadyAsked) {
      pendingJulietQuestions.set(to, { name: customerName, cleanPhone, time: Date.now() });
      try {
        await client.sendMessage(JULIET_NUMBER,
          `💬 *ענית ל${customerName}* ידנית\n\n` +
          `האם הבוט ימשיך לטפל בה אוטומטית?\n\n` +
          `✅ כתבי *כן* — הבוט ממשיך\n` +
          `❌ כתבי *לא* — הבוט שותק ל-3 שעות`
        );
      } catch(e) {}
    }
    console.log(`💬 ג'ולייט כותבת ל-${to} — נשאלת האם להמשיך`);
    return;
  }

  const bodyLow = (message.body || '').trim().toLowerCase();
  if (!bodyLow) return;

  console.log(`📋 הודעה עצמית: ${message.body}`);

  // ── זיהוי תגובה להתראת מחיר (ציטוט) ──────────────────────
  // ג'ולייט ציטטה את הודעת "לקוחה שואלת על מחיר" וענתה עם הסכום
  if (message.hasQuotedMsg) {
    try {
      const quoted = await message.getQuotedMessage();
      if (quoted && quoted.body && quoted.body.includes('לקוחה שואלת על מחיר')) {
        const phoneMatch = quoted.body.match(/—\s*(0\d{9})/);
        const serviceMatch = quoted.body.match(/שירות:\s*\*([^*\n]+)\*/);
        if (phoneMatch) {
          const phone = phoneMatch[1];
          const service = serviceMatch ? serviceMatch[1] : 'החלקה אורגנית OXO';
          const priceRaw = (message.body || '').trim().replace(/[^0-9₪]/g,'');
          if (priceRaw) {
            const crm = loadCRM();
            const custName = (crm[phone] && crm[phone].name) || '';
            const chatId = '972' + phone.replace(/^0/,'') + '@c.us';
            await client.sendMessage(chatId, buildPriceMessage(custName, service, priceRaw));
            if (crm[phone] && crm[phone].pendingPriceRequest) {
              delete crm[phone].pendingPriceRequest;
              saveCRM(crm);
            }
            await message.reply(`✅ נשלח פיץ' מלא + מחיר ₪${priceRaw} ל-${custName || phone}! 💎`);
            return;
          }
        }
      }
    } catch(e) {}
  }

  // ── תגובה לשאלת המשך/שתיקה ────────────────────────────────────
  if (pendingJulietQuestions.size > 0 && (bodyLow === 'כן' || bodyLow === 'לא' || bodyLow === 'yes' || bodyLow === 'no')) {
    // מצא את השאלה האחרונה שנשלחה
    let latestTo = null, latestTime = 0;
    pendingJulietQuestions.forEach((val, key) => {
      if (val.time > latestTime) { latestTime = val.time; latestTo = key; }
    });
    if (latestTo) {
      const { name, cleanPhone } = pendingJulietQuestions.get(latestTo);
      pendingJulietQuestions.delete(latestTo);
      if (bodyLow === 'כן' || bodyLow === 'yes') {
        if (userState[latestTo]) delete userState[latestTo].julietHandling;
        await message.reply(`✅ הבוט ממשיך לטפל ב${name} אוטומטית 💎`);
      } else {
        if (!userState[latestTo]) userState[latestTo] = {};
        userState[latestTo].julietHandling = Date.now();
        await message.reply(`🤫 הבוט שותק ל-3 שעות עבור ${name} 💎`);
      }
      return;
    }
  }

  const isAdmin = ADMIN_KEYWORDS.some(k => bodyLow.startsWith(k) || bodyLow.includes(k));
  if (isAdmin) {
    await handleJulietCommand(message);
  } else {
    // שיחה אנושית עם ג'ולייט
    const crm = loadCRM();
    const totalCustomers = Object.keys(crm).length;
    const today = Object.values(crm).filter(c => {
      if (!c.lastSeen) return false;
      return (Date.now() - new Date(c.lastSeen)) < 86400000;
    }).length;
    const upcoming = Object.values(crm).filter(c => c.pendingAppointment && new Date(c.pendingAppointment) > new Date()).length;

    if (bodyLow.includes('מה שלומ') || bodyLow === 'מה נשמע' || bodyLow === 'הי' || bodyLow === 'היי' || bodyLow === 'שלום') {
      await message.reply(`הכל תקין! 💎\n\nהיום פנו *${today}* לקוחות\nתורים קרובים: *${upcoming}*\nסה"כ ב-CRM: *${totalCustomers}*\n\nאיך אני יכולה לעזור? 😊`);
    } else if (bodyLow.includes('תודה') || bodyLow.includes('כל הכבוד') || bodyLow.includes('יופי')) {
      await message.reply(`תמיד בשבילך! 🤍💎`);
    } else if (bodyLow.includes('כמה לקוח') || bodyLow.includes('סטטוס') || bodyLow.includes('מצב')) {
      await message.reply(`📊 *סטטוס מהיר:*\n\n👥 סה"כ לקוחות: *${totalCustomers}*\n📅 פעילות היום: *${today}*\n🗓 תורים קרובים: *${upcoming}*\n\nלפירוט מלא כתבי *סטטיסטיקה* 💎`);
    } else if (bodyLow.includes('תור') || bodyLow.includes('פנוי')) {
      await message.reply(`📅 לעדכון תורים פנויים כתבי:\n\n\`\`\`פנויים\nראשון 6/4 10:00\nשלישי 8/4 13:00\`\`\`\n\nלרשימת כל הפקודות: *עזרה* 💎`);
    } else {
      await message.reply(`היי! 💎 אני כאן 😊\n\nכתבי *עזרה* לרשימת כל מה שאני יכולה לעשות בשבילך 🤍`);
    }
  }
});

// ── לוגיקה ראשית — הודעות נכנסות מלקוחות ──────────────────
client.on('message', async (message) => {
  const from = message.from;
  console.log(`📨 הודעה מ: ${from} | טקסט: ${message.body ? message.body.substring(0,30) : '[ללא טקסט]'} | fromMe: ${message.fromMe}`);

  // התעלם מקבוצות
  if (from.endsWith('@g.us')) return;
  if (message.isGroupMsg) return;
  if (message.id && message.id.remote && message.id.remote.endsWith('@g.us')) return;

  // התעלם לחלוטין מסטורי / סטטוס / broadcast
  if (from === 'status@broadcast') return;
  if (message.type === 'status') return;
  if (from.includes('broadcast')) return;
  if (message.isStatus) return;

  // התעלם מהודעות שלך (מטופל ב-message_create)
  if (message.fromMe) return;

  // ── אם ג'ולייט מתכתבת עם הלקוחה — בוט שותק ─────────────────
  if (userState[from] && userState[from].julietHandling) {
    const elapsed = Date.now() - userState[from].julietHandling;
    if (elapsed < 3 * 60 * 60 * 1000) {
      // עדכן CRM בלבד (שמירת לוג) — ללא תגובה אוטומטית
      if (message.body) {
        const crm = loadCRM();
        const cleanPhone = from.replace('@c.us','').replace('972','0');
        if (crm[cleanPhone]) {
          crm[cleanPhone].chatLog = crm[cleanPhone].chatLog || [];
          crm[cleanPhone].chatLog.push({ from: 'customer', text: message.body, time: new Date().toISOString() });
          if (crm[cleanPhone].chatLog.length > 50) crm[cleanPhone].chatLog = crm[cleanPhone].chatLog.slice(-50);
          saveCRM(crm);
        }
      }
      console.log(`🤫 בוט שותק — ג'ולייט מטפלת ב-${from}`);
      return;
    } else {
      // פג תוקף — הבוט חוזר לפעולה
      delete userState[from].julietHandling;
    }
  }

  // ── אם ג'ולייט כותבת מהמספר האישי שלה — פקודות מנהל ──────────
  if (isJulietNumber(from)) {
    await handleJulietCommand(message);
    return;
  }

  // ── זיהוי תמונות — העברה לג'ולייט ──────────────────────────
  if (message.hasMedia && message.type === 'image') {
    const name = (userState[from] && userState[from].name) || '';
    const cleanPhone = from.replace('@c.us', '').replace('972', '0');

    // עדכון CRM
    updateCustomer(from, { lastPhotoSent: new Date().toISOString() });

    // הודעה ללקוחה — מיידית
    await message.reply(
      `📸 קיבלתי את התמונה${name ? ' ' + name : ''}! 💎\n\n` +
      `ג'ולייט תבדוק אישית ותחזור אלייך עם מחיר מותאם בהקדם 🙏\n\n` +
      `_הטיפולים בתיאום מראש בלבד — יוליה תחזור אלייך בהקדם_ 🙏`
    );

    // העברת התמונה + פרטים לג'ולייט
    try {
      await client.sendMessage(JULIET_NUMBER,
        `📸 *תמונה חדשה מלקוחה!*\n\n` +
        `👤 שם: *${name || 'לא ידוע'}*\n` +
        `📞 טלפון: *${cleanPhone}*\n\n` +
        `💬 לאחר שתחליטי על המחיר — כתבי לה ישירות:\n` +
        `https://wa.me/972${cleanPhone.replace(/^0/, '')}`
      );
      // שלח את התמונה עצמה
      await message.forward(JULIET_NUMBER);
    } catch(e) {
      console.log('⚠️ שגיאה בהעברת תמונה:', e.message);
    }
    return;
  }

  const body = (message.body || '').trim();
  const bodyLower = body.toLowerCase();
  const hour = getIsraelHour();

  // ── שמירת לוג שיחה ───────────────────────────────────────────
  if (body) {
    const crm = loadCRM();
    const cleanPhone = from.replace('@c.us','').replace('972','0');
    if (!crm[cleanPhone]) crm[cleanPhone] = { phone: cleanPhone, firstContact: new Date().toISOString(), visits: [] };
    if (!crm[cleanPhone].chatLog) crm[cleanPhone].chatLog = [];
    crm[cleanPhone].chatLog.push({ from: 'customer', text: body, time: new Date().toISOString() });
    if (crm[cleanPhone].chatLog.length > 50) crm[cleanPhone].chatLog = crm[cleanPhone].chatLog.slice(-50);
    saveCRM(crm);
  }

  // ── תגובה להקלטה קולית ───────────────────────────────────────
  if (message.type === 'ptt' || message.type === 'audio') {
    await message.reply(`לא יכולה להאזין כרגע 😊\n\nכתבי לי בטקסט ואחזור אלייך בהקדם 💎`);
    return;
  }

  // ✅ התעלם מסטיקרים/קבצים ללא טקסט
  if (!body && !message.hasMedia) return;
  if (message.type === 'sticker') return;

  // ── בדיקת היעדרות ────────────────────────────────────────
  if (isAbsent) {
    const alreadySentAbsent = userState[from] && userState[from].absentNotified;
    if (!alreadySentAbsent) {
      if (!userState[from]) userState[from] = { step: 'main' };
      userState[from].absentNotified = true;
      await message.reply(`היי! 💎\n\n${absentMessage}\n\nנחזור אלייך בהקדם 🙏`);
    }
    return;
  }
  if (userState[from]) userState[from].absentNotified = false;

  // ── בדיקת שעות פעילות ────────────────────────────────────
  const currentHour = getIsraelHour();
  if (currentHour < OPEN_HOUR || currentHour >= CLOSE_HOUR) {
    const alreadySentClosed = userState[from] && userState[from].closedNotified;
    if (!alreadySentClosed) {
      if (!userState[from]) userState[from] = { step: 'main' };
      userState[from].closedNotified = true;
      await message.reply(
        `היי! 💎 קיבלנו את הודעתך 🤍\n\n` +
        `אנחנו כרגע לא זמינות — שעות הפעילות שלנו הן *${OPEN_HOUR}:00–${CLOSE_HOUR}:00* 🕘\n\n` +
        `נחזור אלייך מחר בבוקר! 😊`
      );
    }
    return;
  }
  if (userState[from]) userState[from].closedNotified = false;

  // בדיקת שם מה-CRM (גם אחרי ריסטרט)
  if (!userState[from]) {
    const crm = loadCRM();
    const cleanPhone = from.replace('@c.us', '').replace('972', '0');
    const existing = crm[cleanPhone];
    if (existing && existing.name) {
      userState[from] = { step: 'main', name: existing.name };
    }
  }

  // פתיחת שיחה — על כל הודעה ראשונה או ברכה
  if (!userState[from] || GREETINGS.some(g => bodyLower === g || bodyLower.startsWith(g + ' ')) || isRussian(body)) {
    const knownName = userState[from] && userState[from].name;
    const ru = isRussian(body);
    if (knownName) {
      userState[from].step = 'main';
      userState[from].lang = ru ? 'ru' : 'he';
      // בנה ברכה עם זיכרון מה-CRM
      const crmData = loadCRM();
      const cleanPh = from.replace('@c.us','').replace('972','0');
      const cust = crmData[cleanPh];
      let memoryHint = '';
      if (cust) {
        if (cust.lastService) memoryHint = `\n\n_זוכרת אותך מ${cust.lastService} 💎_`;
        else if (cust.interestedIn) memoryHint = `\n\n_בפעם הקודמת התעניינת ב${cust.interestedIn} 😊_`;
        else if (cust.visits && cust.visits.length > 0) {
          const last = [...cust.visits].reverse().find(v => v.service);
          if (last) memoryHint = `\n\n_שמחה לראותך שוב! בפעם הקודמת: ${last.service} 💎_`;
        }
      }
      await message.reply(ru
        ? `Привет ${knownName}! 💎 Рада тебя слышать снова 🤍\n\n${MAIN_MENU_RU}`
        : `${getGreeting()} ${knownName}! 💎 כיף לשמוע ממך שוב 🤍${memoryHint}\n\n${MAIN_MENU}`
      );
    } else {
      userState[from] = { step: 'ask_name', lang: ru ? 'ru' : 'he' };
      await message.reply(ru
        ? `Привет! 💎 Рада, что написали!\n\nЯ Юля — парикмахер и AI-создатель из Ашдода 😊\n\nКак вас зовут?`
        : `${getGreeting()}! 💎 שמחה שפנית!\n\nאני יוליה — מעצבת שיער ויוצרת AI מאשדוד 😊\n\nרק שאדעי — *איך קוראים לך?*`
      );
    }
    return;
  }

  // ── זיהוי כוונה חופשי — גם בלי תפריט ───────────────────────
  if (!userState[from]) {
    const intentBeauty = ['החלק','שיער','קרטין','תוספות','צבע','הייליטס','בלייץ','אומברה','oxo','החלקה'];
    const intentAI = ['אתר','בוט','וואטסאפ','סרטון','ai','דיגיטל','עיצוב','לוגו','שיווק'];
    const intentBook = ['תור','לקבוע','פגישה','להגיע','זמן פנוי'];

    const bl = bodyLower;
    if (intentBeauty.some(k => bl.includes(k))) {
      userState[from] = { step: 'beauty' };
      await message.reply(`${getGreeting()}! 💎 שמחה שפנית!\n\nאני יוליה — מעצבת שיער מאשדוד 😊\n\n*איך קוראים לך?*`);
      userState[from] = { step: 'ask_name', nextStep: 'beauty' };
      return;
    }
    if (intentAI.some(k => bl.includes(k))) {
      userState[from] = { step: 'ask_name', nextStep: 'ai' };
      await message.reply(`${getGreeting()}! 💎 שמחה שפנית!\n\nאני יוליה — יוצרת AI ומעצבת דיגיטל 🤖\n\n*איך קוראים לך?*`);
      return;
    }
    if (intentBook.some(k => bl.includes(k))) {
      userState[from] = { step: 'ask_name', nextStep: 'booking' };
      await message.reply(`${getGreeting()}! 💎 כיף שפנית!\n\nאני יוליה — נשמח לסדר לך תור 😊\n\n*איך קוראים לך?*`);
      return;
    }
    // לא זוהתה כוונה — שתיקה
    return;
  }

  const state = userState[from];

  // ── שאלת שם ────────────────────────────────
  if (state.step === 'ask_name') {
    userState[from].name = body;
    updateCustomer(from, { name: body });
    const next = state.nextStep || 'main';
    const ru = state.lang === 'ru';
    if (next === 'beauty') {
      userState[from].step = 'beauty';
      await message.reply(ru ? `Очень приятно, ${body}! 🤍\n\n${BEAUTY_MENU_RU}` : `נעים מאוד ${body}! 🤍\n\n${BEAUTY_MENU}`);
    } else if (next === 'ai') {
      userState[from].step = 'ai';
      await message.reply(`נעים מאוד ${body}! 🤍\n\n${AI_MENU}`);
    } else if (next === 'booking') {
      userState[from].step = 'beauty';
      await message.reply(ru ? `Очень приятно, ${body}! 🤍\n\n${BEAUTY_MENU_RU}` : `נעים מאוד ${body}! 🤍\n\n${BEAUTY_MENU}`);
    } else {
      userState[from].step = 'main';
      await message.reply(ru ? `Очень приятно, ${body}! 🤍\n\n${MAIN_MENU_RU}` : `נעים מאוד ${body}! 🤍\n\n${MAIN_MENU}`);
    }
    return;
  }

  const name = state.name || '';

  // ── תפריט ראשי ─────────────────────────────
  if (state.step === 'main') {
    if (body === '1') {
      userState[from].step = 'ai';
      updateCustomer(from, { businessType: 'universe' });
      await message.reply(AI_MENU);
    } else if (body === '2') {
      userState[from].step = 'beauty';
      updateCustomer(from, { businessType: 'beauty' });
      await message.reply(BEAUTY_MENU);
    } else if (body === '3') {
      userState[from].step = 'faq';
      await message.reply(FAQ_MENU);
    } else if (body === '4') {
      // פנייה אישית — בדיקת שעה
      if (hour >= 20 || hour < 8) {
        await message.reply(`היי ${name} 💎\n\nתודה שפנית ל-*Juliet Beauty*! 🙏\n\nהטיפולים אצלנו *בתיאום מראש בלבד*\n_(ללא שבת)_\n\nיוליה תחזור אלייך בהקדם! 💎\n\nאפשר להשאיר הודעה ונחזור אלייך 😊`);
        userState[from].step = 'personal_after_hours';
      } else {
        userState[from].step = 'personal';
        await message.reply(`💬 *פנייה אישית*\n\n${name ? `${name}, ` : ''}ג'ולייט תחזור אלייך בהקדם! 🙏\n\n📸 @juliet_beauty_boutique\n🌐 https://juliet-beauty-boutique.netlify.app/`);
      }
    } else {
      await message.reply(`בחרי מספר בין 1-4 בבקשה 😊\n\n${MAIN_MENU}`);
    }
    return;
  }

  // ── תפריט AI ───────────────────────────────
  if (state.step === 'ai') {
    if (body === '6') {
      userState[from].step = 'main';
      await message.reply(MAIN_MENU);
    } else if (AI_ANSWERS[body]) {
      const pkg = AI_ANSWERS[body];
      userState[from].aiService = pkg.service;
      userState[from].step = 'ai_interest';
      await message.reply(pkg.msg);
      // התראה לג'ולייט — ליד מתעניין
      const cleanPhoneAI = from.replace('@c.us','').replace('972','0');
      try {
        await client.sendMessage(JULIET_NUMBER,
          `💡 *ליד Universe — מתעניינת!*\n\n` +
          `👤 ${name || 'לקוחה'}\n` +
          `📞 ${cleanPhoneAI}\n` +
          `💼 בודקת: *${pkg.service}*\n\n` +
          `_ממתינה לתשובתה — אל תפספסי!_`
        );
      } catch(e) {}
    } else {
      await message.reply(`בחרי מספר בין 1-6 בבקשה 😊\n\n${AI_MENU}`);
    }
    return;
  }

  // ── AI Interest — לאחר שבחרה חבילה ────────────────────────
  if (state.step === 'ai_interest') {
    const service = state.aiService || 'שירות AI';
    if (bodyLower.includes('כן') || bodyLower.includes('רוצה') || bodyLower.includes('מעוניינת') || bodyLower.includes('כמובן') || bodyLower.includes('בטח')) {
      // ביטול follow-ups קודמים
      if (aiFollowups[from]) {
        clearTimeout(aiFollowups[from].t24);
        clearTimeout(aiFollowups[from].t48);
        delete aiFollowups[from];
      }

      // שמור ב-CRM
      updateCustomer(from, { interestedIn: service, leadStatus: 'hot', leadDate: new Date().toISOString() });

      // שמור בגוגל שיטס
      const cleanPhone = from.replace('@c.us', '').replace('972', '0');
      sendToGoogleSheets({
        name: name || 'לא ידוע',
        phone: cleanPhone,
        service,
        status: 'ליד חם 🔥',
        source: 'WhatsApp Bot'
      });

      // התראה לג'ולייט
      try {
        await client.sendMessage(JULIET_NUMBER,
          `🔥 *ליד חם חדש!*\n\n` +
          `👤 שם: *${name || 'לא ידוע'}*\n` +
          `📞 טלפון: *${cleanPhone}*\n` +
          `💼 שירות: *${service}*\n\n` +
          `חזרי אליה בהקדם! 💎`
        );
      } catch(e) {}

      await message.reply(`מעולה ${name ? name : ''}! 💎\n\nג'ולייט תחזור אליך בהקדם לתיאום 🙏\n\n_בינתיים אפשר לראות את האתר שלנו:_\nhttps://juliet-universe-official.netlify.app`);
      userState[from].step = 'main';
    } else if (bodyLower.includes('לא') || bodyLower.includes('תודה')) {
      // תזמן follow-up
      scheduleAIFollowup(from, name || '', service);
      await message.reply(`בסדר גמור 😊 אם תחשבי מחדש — אני כאן!\n\n${AI_MENU}`);
      userState[from].step = 'ai';
    } else {
      // כל הודעה אחרת — תזמן follow-up ושמור כ-warm lead
      updateCustomer(from, { interestedIn: service, leadStatus: 'warm', leadDate: new Date().toISOString() });
      const cleanPhone = from.replace('@c.us', '').replace('972', '0');
      sendToGoogleSheets({
        name: name || 'לא ידוע',
        phone: cleanPhone,
        service,
        status: 'ליד חם 🟡',
        source: 'WhatsApp Bot'
      });
      scheduleAIFollowup(from, name || '', service);
      await message.reply(`הבנתי 😊\n\nג'ולייט תחזור אליך לפרטים נוספים 💎`);
      userState[from].step = 'main';
    }
    return;
  }

  // ── תפריט Beauty ───────────────────────────
  if (state.step === 'beauty') {
    if (pendingOffers[from]) { clearTimeout(pendingOffers[from]); delete pendingOffers[from]; }
    if (body === '1') {
      // נכנסת לתת-תפריט החלקה
      userState[from].step = 'straightening';
      userState[from].lastService = 'החלקה אורגנית OXO'; // ✅ תיקון באג 1
      await message.reply(STRAIGHTENING_MENU);
    } else if (body === '4') {
      await message.reply(CATALOG_MESSAGE);
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
      // ✅ תיקון — שמור lastService לפי הבחירה
      const serviceMap = { '2': 'תוספות שיער', '3': 'צבע והייליטס' };
      if (serviceMap[body]) userState[from].lastService = serviceMap[body];
      await message.reply(BEAUTY_ANSWERS[body]);
      pendingOffers[from] = setTimeout(async () => {
        try {
          const chat = await message.getChat();
          await chat.sendMessage(`היי ${name || ''} 💎\n\nעדיין מתלבטת? 😊\n\n🎁 *הצעה מיוחדת:* קבעי תור עד מחר וקבלי *10% הנחה*!\n\nכתבי *"רוצה לקבוע"* ואחזור אלייך 💇‍♀️`);
          userState[from] = { ...userState[from], step: 'booking' };
          delete pendingOffers[from];
        } catch(e) {}
      }, 24 * 60 * 60 * 1000);
      setTimeout(async () => {
        await message.reply(`💇‍♀️ ${name ? `${name}, ` : ''}רוצה לקבוע תור?\n\nכתבי *"קביעה"* ואסדר אותך 😊`);
        userState[from].step = 'booking';
      }, 4000);
    } else {
      await message.reply(`בחרי מספר בין 1-5 בבקשה 😊\n\n${BEAUTY_MENU}`);
    }
    return;
  }

  // ── תת-תפריט החלקה אורגנית OXO ──────────────────────────────
  if (state.step === 'straightening') {
    if (body === '6') {
      userState[from].step = 'beauty';
      await message.reply(BEAUTY_MENU);
    } else if (body === '4') {
      // מחירים — ללא הצגת מחיר, רק תמונה + התראה לג'ולייט
      const cleanPhoneSt = from.replace('@c.us','').replace('972','0');
      await notifyPriceRequest(from, name, 'החלקה אורגנית OXO');
      await message.reply(
        `💰 *מחיר מותאם אישית*\n\n` +
        `${name ? name + ', ' : ''}המחיר תלוי באורך ועובי השיער שלך 💎\n\n` +
        `📸 *שלחי תמונה של השיער* — ויוליה תחזור אלייך עם מחיר מדויק בהקדם! 🙏\n\n` +
        `🗓️ _הטיפולים בתיאום מראש בלבד_`
      );
    } else if (body === '5') {
      // ✅ תיקון באג 2 — אינסטגרם לא מעביר לקביעה, נשארת בתפריט
      await message.reply(STRAIGHTENING_ANSWERS['5']);
      setTimeout(async () => {
        await message.reply(`יש לך עוד שאלות על ההחלקה? 😊\n\n${STRAIGHTENING_MENU}`);
      }, 2000);
    } else if (STRAIGHTENING_ANSWERS[body]) {
      await message.reply(STRAIGHTENING_ANSWERS[body]);
      // הצעת קביעת תור לאחר כל תשובה
      setTimeout(async () => {
        await message.reply(`יש לך עוד שאלות? ${STRAIGHTENING_MENU}`);
      }, 2000);
    } else {
      await message.reply(`בחרי מספר בין 1-6 בבקשה 😊\n\n${STRAIGHTENING_MENU}`);
    }
    return;
  }

  // ── קביעת תור — שלב 1: בחירת תור פנוי ──────────────────────
  if (state.step === 'booking') {
    if (bodyLower.includes('קביעה') || bodyLower.includes('רוצה') || bodyLower.includes('כן') || body === '4') {
      // ── מחיר לפי שירות לפני קביעה ──
      const SERVICE_PRICES = {
        'החלקה אורגנית OXO': 'החלקה מלאה החל מ-*₪1,000* · חידוש שורשים *₪850*',
        'תוספות שיער': 'קראטין *₪22 לגרם* · צמידים *₪2,500 ל-100 גרם*',
        'צבע והייליטס': 'המחיר לפי אורך ועובי השיער — שלחי תמונה לקבלת מחיר מדויק 📸',
      };
      const svc = state.lastService;
      const priceHint = svc && SERVICE_PRICES[svc] ? `\n💰 *מחיר:* ${SERVICE_PRICES[svc]}\n` : '';

      const available = getAvailableSlots();
      if (available.length > 0) {
        userState[from].step = 'booking_slot';
        userState[from].slotOptions = available.slice(0, 8);
        await message.reply(
          `מעולה ${name}! 💎 נקבע לך תור 📅\n${priceHint}\n*בחרי תור פנוי:*\n\n` +
          available.slice(0, 8).map((s, i) => `${i + 1}. ${s.label}`).join('\n') +
          `\n\nשלחי את המספר המתאים 😊`
        );
      } else {
        // אין תורים פנויים — העברת שיחה לג'ולייט
        userState[from].step = 'main';
        const cleanPhoneBook = from.replace('@c.us','').replace('972','0');
        await message.reply(
          `${name ? name + ', ' : ''}אין לנו תורים פנויים ממש עכשיו 📅\n\n` +
          `ג'ולייט תחזור אלייך תוך זמן קצר כדי לתאם זמן מתאים! 🤍`
        );
        try {
          await client.sendMessage(JULIET_NUMBER,
            `📅 *בקשת תור — אין תורים פנויים!*\n\n` +
            `👤 *${name || 'לקוחה'}*\n` +
            `📞 ${cleanPhoneBook}\n\n` +
            `💇‍♀️ שירות: ${state.lastService || 'לא צוין'}\n\n` +
            `⚡ יש לחזור אליה לתיאום תור!\n` +
            `https://wa.me/972${cleanPhoneBook.replace(/^0/,'')}`
          );
        } catch(e) {}
      }
    } else {
      const prev = state.prevStep || 'beauty';
      userState[from].step = prev;
      userState[from].prevStep = null;
      await message.reply(prev === 'straightening' ? STRAIGHTENING_MENU : BEAUTY_MENU);
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
      updateCustomer(from, { pendingAppointmentRequest: `${chosen.label} — ${service}`, rootsReminderSent: false, reviewSent: false });

      await message.reply(
        `✅ *הבקשה נשלחה לג'ולייט!*\n\n` +
        `📅 ${chosen.label}\n💇‍♀️ ${service}\n\n` +
        `ג'ולייט תאשר בקרוב 💎🙏`
      );

      // התראה לג'ולייט
      const customerPhone = from.replace('@c.us', '').replace('972', '0');
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

  // ── קביעת תור — שלב 3: שליחה לג'ולייט ──────────────────────
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
    updateCustomer(from, { pendingAppointmentRequest: `${day.label} ${timeSlot} — ${service}`, rootsReminderSent: false, reviewSent: false });

    // שלח ללקוחה אישור
    await message.reply(
      `✅ *קיבלנו את הבקשה שלך!*\n\n` +
      `📅 יום: *${day.label}*\n⏰ שעה: *${timeSlot}*\n💇‍♀️ שירות: *${service}*\n\n` +
      `ג'ולייט תאשר את התור בקרוב ותשלח לך אישור סופי 💎🙏`
    );

    // שלח התראה לג'ולייט
    const customerPhone = from.replace('@c.us', '').replace('972', '0');
    try {
      await client.sendMessage(JULIET_NUMBER,
        `💎 *בקשת תור חדשה!*\n\n` +
        `👤 שם: *${name}*\n📞 טלפון: *${customerPhone}*\n` +
        `📅 יום: *${day.label}*\n⏰ שעה: *${timeSlot}*\n💇‍♀️ שירות: *${service}*\n\n` +
        `לאישור: \`אישרתי ${customerPhone} HH:MM\`\n` +
        `לביטול: \`ביטלתי ${customerPhone}\``
      );
    } catch(e) {
      console.log('שגיאה בשליחה לג\'וליאט:', e.message);
    }

    userState[from].step = 'main';
    return;
  }

  // ── אישור תור סופי (אחרי שג'ולייט מאשרת) ───────────────────
  if (state.step === 'confirm_booking') {
    addVisit(from, state.lastService || 'תור כללי');
    // חשב תאריך מדויק מהבחירה
    const apptDate = state.selectedDay ? new Date(state.selectedDay.date) : null;
    if (apptDate) {
      updateCustomer(from, { pendingAppointment: apptDate.toISOString(), reminderSent: false });
    }
    await message.reply(`✅ התור אושר! ג'ולייט מחכה לך 💎\n\nתקבלי תזכורת יום לפני 🗓️`);
    userState[from].step = 'main';
    return;
  }

  // ── FAQ ────────────────────────────────────
  if (state.step === 'faq') {
    if (body === '6') {
      userState[from].step = 'main';
      await message.reply(MAIN_MENU);
    } else if (body === '1') {
      // מחיר — רק תמונה + התראה לג'ולייט
      await notifyPriceRequest(from, name, 'החלקה אורגנית OXO');
      await message.reply(
        `💰 *מחיר מותאם אישית*\n\n` +
        `${name ? name + ', ' : ''}המחיר תלוי באורך ועובי השיער 💎\n\n` +
        `📸 *שלחי תמונה של השיער* — ויוליה תחזור אלייך עם מחיר בהקדם! 🙏`
      );
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
    await message.reply(`תודה ${name}! 💎\n\nקיבלנו את ההודעה שלך — יוליה תחזור אלייך בהקדם 🙏\n_(הטיפולים בתיאום מראש בלבד, ללא שבת)_`);
    // ✅ תיקון — שלח התראה לג'ולייט גם בלילה
    try {
      const cleanPhone = from.replace('@c.us','').replace('972','0');
      await client.sendMessage(JULIET_NUMBER,
        `🌙 *הודעה מחוץ לשעות פעילות!*\n\n👤 שם: *${name || 'לא ידוע'}*\n📞 טלפון: *${cleanPhone}*\n\n📝 ההודעה:\n"${body}"\n\n_חזרי אליה מחר בשעות הפעילות_ 🙏`
      );
    } catch(e) {}
    return;
  }

  // ── Personal — ג'ולייט עונה ידנית ───────────
  if (state.step === 'personal') {
    console.log(`📩 הודעה אישית מ-${from} (${name}): ${body}`);
    await message.reply(`תודה ${name ? name : ''}! 💎\n\nקיבלנו את הודעתך — ג'ולייט תחזור אלייך בהקדם 🙏`);
    try {
      const cleanPhone = from.replace('@c.us','').replace('972','0');
      await client.sendMessage(JULIET_NUMBER,
        `💬 *הודעה אישית חדשה!*\n\n👤 שם: *${name || 'לא ידוע'}*\n📞 טלפון: *${cleanPhone}*\n\n📝 ההודעה:\n"${body}"\n\nhttps://wa.me/972${cleanPhone.replace(/^0/,'')}`
      );
    } catch(e) {}
    return;
  }

  // ── "התור שלי" — בדיקת תור עצמאית ──────────────────────────────
  if (bodyLower.includes('התור שלי') || bodyLower === 'תור' || bodyLower.includes('מתי התור')) {
    const crm = loadCRM();
    const cleanPhone = from.replace('@c.us','').replace('972','0');
    const customer = crm[cleanPhone];
    if (customer && customer.pendingAppointment) {
      const apptDate = new Date(customer.pendingAppointment);
      const apptStr = apptDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
      const service = customer.lastService || 'טיפול';
      await message.reply(
        `📅 *התור שלך:*\n\n` +
        `🗓️ *${apptStr}*\n` +
        `💇‍♀️ ${service}\n\n` +
        `אם צריך לשנות — כתבי *"לבטל תור"* 😊`
      );
    } else if (customer && customer.pendingAppointmentRequest) {
      await message.reply(
        `📅 *הבקשה שלך נקלטה!*\n\n` +
        `${customer.pendingAppointmentRequest}\n\n` +
        `_ג'ולייט תאשר בקרוב_ 💎`
      );
    } else {
      await message.reply(
        `לא מצאתי תור פעיל על שמך ${name ? name : ''} 😊\n\n` +
        `כתבי *"קביעה"* כדי לקבוע תור חדש 💎`
      );
    }
    return;
  }

  // ── ביטול תור עצמאי ──────────────────────────────────────────
  if (bodyLower.includes('לבטל') || bodyLower.includes('ביטול תור') || bodyLower.includes('לא יכולה להגיע')) {
    const crm = loadCRM();
    const cleanPhone = from.replace('@c.us','').replace('972','0');
    const customer = crm[cleanPhone];
    if (customer && customer.pendingAppointment) {
      delete crm[cleanPhone].pendingAppointment;
      delete crm[cleanPhone].pendingAppointmentRequest;
      delete crm[cleanPhone].reminderSent;
      saveCRM(crm);
      // התראה לג'ולייט
      try {
        await client.sendMessage(JULIET_NUMBER,
          `🚫 *ביטול תור!*\n\n👤 ${name || 'לא ידוע'}\n📞 ${cleanPhone}\n\n_הלקוחה ביטלה את התור בעצמה_`
        );
      } catch(e) {}
      await message.reply(`${name ? name + ', ' : ''}בוטל ✅\n\nמקווה לראותך בפעם אחרת 🤍\n\nכשתרצי לקבוע שוב — פשוט כתבי *"קביעה"* 😊`);
    } else {
      await message.reply(`לא מצאתי תור פעיל על שמך ${name ? name : ''} 😊\n\nכשתרצי לקבוע כתבי *"קביעה"*`);
    }
    return;
  }

  // ── זיהוי הודעה שלילית — התראה דחופה לג'ולייט ───────────────────
  const NEGATIVE_WORDS = ['לא מרוצה','לא מרוצה','בעיה','גרוע','גרועה','נורא','נוראי','מאכזב','מאכזבת','התאכזבתי','כועסת','כועס','זעם','ממש רע','לא טוב','לא הייתי','פגע','נזק','שרף','שבר','שרפת','פגמת','מקולקל','לא עבד','לא עובד','החזר כסף','רוצה החזר','תביעה','עורך דין'];
  if (NEGATIVE_WORDS.some(w => bodyLower.includes(w))) {
    // תגובה אמפתית ללקוחה
    await message.reply(
      `${name ? name + ', ' : ''}אני מצטערת לשמוע את זה 🙏\n\n` +
      `חשוב לי מאוד שכל לקוחה תצא מרוצה אצלי.\n\n` +
      `יוליה תחזור אלייך אישית בהקדם כדי לטפל בזה 💎`
    );
    // התראה דחופה לג'ולייט
    const cleanPhone = from.replace('@c.us','').replace('972','0');
    try {
      await client.sendMessage(JULIET_NUMBER,
        `🚨 *התראה דחופה — לקוחה לא מרוצה!*\n\n` +
        `👤 שם: *${name || 'לא ידוע'}*\n` +
        `📞 טלפון: *${cleanPhone}*\n\n` +
        `📝 ההודעה:\n"${body}"\n\n` +
        `⚡ חזרי אליה *עכשיו* לפני שזה מסלים!\n` +
        `https://wa.me/972${cleanPhone.replace(/^0/,'')}`
      );
    } catch(e) {}
    return;
  }

  // ── בקשת ביקורת (כשלקוחה כותבת "ביקורת") ─────────────────────
  if (bodyLower.includes('ביקורת') || bodyLower.includes('כוכבים') || bodyLower.includes('review')) {
    await message.reply(
      `תודה ${name ? name + ' ' : ''}💎 זה אומר לי הכל 🤍\n\n` +
      `ביקורת קטנה שלך עוזרת לי להגיע לעוד נשים מדהימות:\n\n` +
      `⭐ *גוגל (מומלץ!):*\n${GOOGLE_REVIEW_LINK}\n\n` +
      `📘 *פייסבוק:*\n${FACEBOOK_REVIEW_LINK}\n\n` +
      `_תודה מהלב!_ 🙏💎`
    );
    return;
  }

  // ── Fallback — הודעה לא מזוהה — Claude AI ───────────────────
  if (body && !userState[from]) {
    userState[from] = { step: 'main' };
  }
  if (body && userState[from] && (userState[from].step === 'main' || !userState[from].step)) {
    const cleanPhoneFb = from.replace('@c.us','').replace('972','0');
    const crm = loadCRM();
    const chatHistory = crm[cleanPhoneFb] && crm[cleanPhoneFb].chatLog ? crm[cleanPhoneFb].chatLog : [];

    // נסה Claude AI קודם
    const aiReply = await askClaude(body, name, chatHistory);
    let finalReply = aiReply;
    if (aiReply) {
      await message.reply(aiReply);
      // שמור תגובת בוט בלוג
      const crmNow = loadCRM();
      if (crmNow[cleanPhoneFb]) {
        crmNow[cleanPhoneFb].chatLog = crmNow[cleanPhoneFb].chatLog || [];
        crmNow[cleanPhoneFb].chatLog.push({ from: 'bot', text: aiReply, time: new Date().toISOString() });
        if (crmNow[cleanPhoneFb].chatLog.length > 50) crmNow[cleanPhoneFb].chatLog = crmNow[cleanPhoneFb].chatLog.slice(-50);
        saveCRM(crmNow);
      }
      console.log(`🤖 Claude ענה ל-${cleanPhoneFb}`);
    } else {
      // פולבק — שאלת הבהרה לפי תוכן
      const bodyL = body.toLowerCase();
      let clarifyReply = '';
      if (bodyL.includes('מחיר') || bodyL.includes('כמה עולה') || bodyL.includes('כמה זה') || bodyL.includes('עלות')) {
        clarifyReply = `היי${name ? ' ' + name : ''}! 💎\n\nאיזה שירות מעניין אותך?\n\n1️⃣ החלקה אורגנית OXO\n2️⃣ תוספות שיער\n3️⃣ צבע / הייליטס\n\nכתבי מספר ואשלח לך מחיר מדויק 😊`;
      } else if (bodyL.includes('תור') || bodyL.includes('לקבוע') || bodyL.includes('לתאם') || bodyL.includes('פנוי')) {
        clarifyReply = `${name ? name + ', ' : ''}מצוין! 💎\n\nלאיזה שירות תרצי לקבוע?\n\n1️⃣ החלקה אורגנית OXO\n2️⃣ תוספות שיער\n3️⃣ צבע / הייליטס\n\nכתבי מספר ונמצא לך זמן נוח 📅`;
      } else if (bodyL.includes('החלק') || bodyL.includes('שיער') || bodyL.includes('קרטין')) {
        clarifyReply = `היי${name ? ' ' + name : ''}! 💎\n\nרוצה לדעת עוד?\n\n1️⃣ מידע על החלקה OXO\n2️⃣ מחירים\n3️⃣ לקבוע תור\n\nכתבי מספר 😊`;
      } else if (bodyL.includes('תוסף') || bodyL.includes('תוספות')) {
        clarifyReply = `היי${name ? ' ' + name : ''}! 💎\n\nרוצה מידע על תוספות?\n\n1️⃣ מחירים\n2️⃣ לשלוח תמונה לייעוץ אישי\n3️⃣ לקבוע תור\n\nכתבי מספר 😊`;
      } else if (bodyL.includes('אתר') || bodyL.includes('בוט') || bodyL.includes('ai') || bodyL.includes('עסק')) {
        clarifyReply = `היי${name ? ' ' + name : ''}! 💎\n\nרוצה לבנות נוכחות דיגיטלית?\n\n1️⃣ אתר / דף נחיתה\n2️⃣ בוט וואטסאפ\n3️⃣ חבילה מלאה\n4️⃣ ייעוץ חינמי\n\nכתבי מספר 😊`;
      } else {
        clarifyReply = `היי${name ? ' ' + name : ''}! 💎\n\nאפשר לפרט קצת? 😊\n\n1️⃣ שירותי שיער\n2️⃣ שירותי AI לעסק\n3️⃣ שאלה אחרת\n\nכתבי מספר ואני כאן 💎`;
      }
      finalReply = clarifyReply;
      await message.reply(clarifyReply);
    }

    // עדכון ג'ולייט עם הקשר מלא + אפשרויות פעולה
    try {
      await notifyJulietWithContext(from, name, body, finalReply, loadCRM());
    } catch(e) {}
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
// ── תזכורת שבועית לג'ולייט — כל ראשון בשעה 9:00 ──────────────
// ── ברכות חגים אוטומטיות ─────────────────────────────────────
// ✅ תאריכי חגים — לעדכן כל שנה בדצמבר!
// פורמט: { month, day, name, msg }
const HOLIDAYS = [
  { month: 3,  day: 8,  name: 'יום האישה',     msg: `יום האישה הבינלאומי שמח! 🌸\n\nהיום מוקדש לנשים מדהימות כמוך 💎\n\nאת מיוחדת, חזקה ויפה — תמיד! 🤍\n\n_— יוליה & Juliet Beauty_` },
  { month: 3,  day: 13, name: 'פורים',          msg: `פורים שמח! 🎭\n\nשיהיה לך יום מלא שמחה וצחוק 💎\n\n_— יוליה & Juliet Beauty_ 🤍` },
  { month: 4,  day: 7,  name: 'פסח',            msg: `חג פסח שמח וכשר! 🌿\n\nחג של חירות, אביב ואהבה 💎\n\nתחגגי עם המשפחה בשמחה! 🤍\n\n_— יוליה & Juliet Beauty_` },
  { month: 4,  day: 21, name: 'יום העצמאות',   msg: `יום העצמאות שמח! 🇮🇱\n\nגאה להיות ישראלית 💎\n\n_חג שמח מיוליה_ 🤍` },
  { month: 9,  day: 22, name: 'ראש השנה',       msg: `שנה טובה ומתוקה! 🍎🍯\n\nמאחלת לך שנה של בריאות, אהבה והצלחה 💎\n\n_שנה טובה מיוליה ו-Juliet Beauty_ ✨` },
  { month: 10, day: 1,  name: 'יום כיפור',      msg: `גמר חתימה טובה! 🕊️\n\nשתחתמי לחיים טובים ומאושרים 💎\n\n_— יוליה_ 🤍` },
  { month: 12, day: 25, name: 'חנוכה',          msg: `חנוכה שמח! 🕎\n\nשהאור תמיד ינצח את החושך 💎\n\n_חג אורים שמח מיוליה_ ✨` },
];

let sentHolidayToday = null;

function startHolidayGreetings() {
  setInterval(async () => {
    const now = new Date();
    const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const month = israelTime.getMonth() + 1;
    const day = israelTime.getDate();
    const hour = israelTime.getHours();
    const todayKey = `${month}-${day}`;

    // שלח רק פעם אחת ביום, בשעה 9:00
    if (hour !== 9 || sentHolidayToday === todayKey) return;

    // ✅ תזכורת שנתית — 1 בדצמבר בשעה 9:00
    if (month === 12 && day === 1 && hour === 9) {
      try {
        const holidayList = HOLIDAYS.map(h => `• ${h.name}: ${h.day}/${h.month}`).join('\n');
        await client.sendMessage(JULIET_NUMBER,
          `📅 *תזכורת שנתית — עדכון תאריכי חגים!* 💎\n\n` +
          `השנה הקרובה מתקרבת — כדאי לעדכן את תאריכי החגים בבוט.\n\n` +
          `*תאריכים נוכחיים בבוט:*\n${holidayList}\n\n` +
          `לעדכון — פני לי (לתמיכה הטכנית) עם התאריכים החדשים 🙏`
        );
        console.log('📅 נשלחה תזכורת שנתית לעדכון חגים');
      } catch(e) {}
    }

    const holiday = HOLIDAYS.find(h => h.month === month && h.day === day);
    if (!holiday) return;

    sentHolidayToday = todayKey;
    const crm = loadCRM();
    const phones = Object.keys(crm);
    console.log(`🎉 שולחת ברכת חג ל-${phones.length} לקוחות`);

    for (const phone of phones) {
      if (crm[phone] && crm[phone].muted) continue; // ✅ מושתקת — דלג
      try {
        const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
        const custName = crm[phone].name || '';
        await client.sendMessage(chatId,
          `${custName ? `${custName}! ` : ''}${holiday.msg}`
        );
        await new Promise(r => setTimeout(r, 2000));
      } catch(e) {}
    }
    console.log(`✅ ברכת חג נשלחה לכולם`);
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

// ── גיבוי יומי (לוקאלי) ────────────────────────────────────
function startDailyBackup() {
  const BACKUP_DIR = path.join(__dirname, 'backups');
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
  setInterval(() => {
    if (getIsraelHour() !== 3) return; // רק בשעה 3 לפנות בוקר
    const date = new Date().toISOString().split('T')[0];
    const dest = path.join(BACKUP_DIR, `customers-${date}.json`);
    if (fs.existsSync(dest)) return; // כבר גובה היום
    try {
      fs.copyFileSync(CRM_FILE, dest);
      // נקה גיבויים ישנים (שמור 30 אחרונים)
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('customers-'))
        .sort();
      if (files.length > 30) {
        files.slice(0, files.length - 30).forEach(f =>
          fs.unlinkSync(path.join(BACKUP_DIR, f))
        );
      }
      console.log(`💾 גיבוי יומי לוקאלי נשמר: ${dest}`);
    } catch(e) { console.log('⚠️ שגיאה בגיבוי לוקאלי:', e.message); }
  }, 60 * 60 * 1000);
}

// ── גיבוי אוטומטי ל-GitHub ───────────────────────────────────
// נדרש: GITHUB_TOKEN ו-GITHUB_REPO ב-Railway Environment Variables
// GITHUB_TOKEN = Personal Access Token עם הרשאת repo
// GITHUB_REPO  = julietesemenyuk-sudo/juliet-bot
let lastGithubBackupDate = '';

async function backupToGithub() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'julietesemenyuk-sudo/juliet-bot';
  if (!token) return; // אם אין token — דלג בשקט

  try {
    const content = fs.readFileSync(CRM_FILE, 'utf8');
    const encoded = Buffer.from(content).toString('base64');
    const date    = new Date().toISOString().split('T')[0];

    // קבל את ה-SHA הנוכחי של הקובץ (חובה ל-update)
    const getRes = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.github.com',
        path: `/repos/${repo}/contents/customers.json`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'juliet-bot',
          'Accept': 'application/vnd.github+json'
        }
      };
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });

    let sha = null;
    if (getRes.status === 200) {
      sha = JSON.parse(getRes.body).sha;
    }

    // העלה גרסה מעודכנת
    const payload = JSON.stringify({
      message: `💾 Auto-backup customers.json ${date} (${Object.keys(JSON.parse(content)).length} customers)`,
      content: encoded,
      ...(sha ? { sha } : {})
    });

    const putRes = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.github.com',
        path: `/repos/${repo}/contents/customers.json`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'juliet-bot',
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(opts, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    if (putRes.status === 200 || putRes.status === 201) {
      console.log(`✅ גיבוי GitHub הצליח! (${date})`);
      lastGithubBackupDate = date;
    } else {
      console.log(`⚠️ גיבוי GitHub נכשל: ${putRes.status} — ${putRes.body.slice(0,200)}`);
    }
  } catch(e) {
    console.log('⚠️ שגיאה בגיבוי GitHub:', e.message);
  }
}

function startGithubBackupJob() {
  setInterval(async () => {
    if (getIsraelHour() !== 4) return; // כל לילה בשעה 4:00
    const today = new Date().toISOString().split('T')[0];
    if (lastGithubBackupDate === today) return; // כבר גובה היום
    await backupToGithub();
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

// ── עזר: קריאת Lee API עם auth headers שונים ────────────────
async function leeApiRequest(endpoint, apiKey, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
        'x-api-key': apiKey,
        'token': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, raw: data.slice(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// ── סנכרון Lee דרך API Key ────────────────────────────────────
async function syncLeeViaAPI(apiKey, businessId) {
  console.log('🔄 lee sync — משתמש ב-API Key...');
  const now   = new Date();
  const start = now.toISOString().split('T')[0];
  const end   = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString().split('T')[0];

  // שלב 1: נסה קודם לקבל session token ע"י POST /v1/auth עם ה-API Key
  let sessionToken = null;
  try {
    const authRes = await leeApiRequest('https://api.lee.co.il/v1/auth', apiKey, 'POST', { api_key: apiKey });
    console.log('🔑 Lee auth attempt:', authRes.status, JSON.stringify(authRes.json || authRes.raw).slice(0, 100));
    if (authRes.json && (authRes.json.token || authRes.json.access_token || authRes.json.jwt)) {
      sessionToken = authRes.json.token || authRes.json.access_token || authRes.json.jwt;
      console.log('✅ Lee auth — קיבלנו session token!');
    }
  } catch(e) {
    console.log('⚠️ Lee auth failed:', e.message);
  }

  const effectiveKey = sessionToken || apiKey;

  // שלב 2: נסה endpoints שונים — API Key כ-query param, כ-header, ו-businessId שונים
  const endpointVariants = [
    // query param גישה
    `https://api.lee.co.il/v1/appointments?api_key=${effectiveKey}&from=${start}&to=${end}`,
    `https://api.lee.co.il/v1/appointments?key=${effectiveKey}&from=${start}&to=${end}`,
    // business-specific endpoints
    `https://api.lee.co.il/v1/business/${businessId}/appointments?from=${start}&to=${end}`,
    `https://api.lee.co.il/v1/businesses/${businessId}/appointments?from=${start}&to=${end}`,
    `https://api.lee.co.il/v1/calendar?from=${start}&to=${end}`,
    `https://api.lee.co.il/v1/events?from=${start}&to=${end}&status=scheduled`,
    // app subdomain
    `https://app.lee.co.il/api/v1/appointments?from=${start}&to=${end}`,
    `https://app.lee.co.il/api/appointments?businessId=${businessId}&from=${start}&to=${end}`,
  ];

  let appointments = [];
  for (const endpoint of endpointVariants) {
    try {
      const result = await leeApiRequest(endpoint, effectiveKey);
      console.log(`📡 Lee ${endpoint.replace(/api_key=[^&]+/,'api_key=***').split('?')[0].split('/').slice(-3).join('/')}: status=${result.status}`);

      if (result.status === 200 && result.json) {
        const arr = Array.isArray(result.json) ? result.json
          : (result.json.data || result.json.appointments || result.json.events
          || result.json.items || result.json.results || []);
        if (Array.isArray(arr) && arr.length > 0) {
          appointments = arr;
          console.log(`✅ Lee API — נמצאו ${arr.length} תורים מ: ${endpoint.split('/').slice(-2).join('/')}`);
          break;
        } else {
          // לוג מה קיבלנו כדי להבין את מבנה ה-JSON
          console.log(`📋 Lee JSON (no appts): ${JSON.stringify(result.json).slice(0, 150)}`);
        }
      }
    } catch(e) {
      console.log(`⚠️ Lee endpoint נכשל: ${e.message}`);
    }
  }

  if (!appointments.length) {
    console.log('⚠️ lee API sync — לא נמצאו תורים מכל ה-endpoints');
    return 0;
  }

  // שמור ב-CRM
  const crm = loadCRM();
  let added = 0;
  appointments.forEach(evt => {
    const dateStr  = evt.start || evt.startTime || evt.appointmentDate || evt.date || evt.datetime;
    const rawPhone = ((evt.phone || evt.customerPhone || evt.clientPhone ||
                       (evt.customer && evt.customer.phone) || evt.mobile || '')).replace(/\D/g, '');
    if (!dateStr || !rawPhone) return;

    let localPhone = rawPhone;
    if (localPhone.startsWith('972')) localPhone = '0' + localPhone.slice(3);
    if (localPhone.length < 9) return;

    const d = new Date(dateStr);
    if (isNaN(d)) return;
    const iso = d.toISOString();
    const custName = evt.customerName || evt.clientName || (evt.customer && evt.customer.name) || evt.name || '';
    const service  = evt.serviceName || evt.service || evt.treatment || evt.title || 'טיפול';
    const status   = evt.status === '2' || evt.status === 'done' || evt.status === 'completed' ? 'done' : 'scheduled';

    if (!crm[localPhone]) {
      crm[localPhone] = { phone: localPhone, name: custName, firstContact: iso, visits: [], source: 'lee', businessType: 'beauty' };
    }
    crm[localPhone].visits = crm[localPhone].visits || [];
    if (!crm[localPhone].visits.some(v => v.date === iso && v.service === service)) {
      crm[localPhone].visits.push({ date: iso, service, source: 'lee', status });
      if (custName) crm[localPhone].name = custName;
      crm[localPhone].lastService = service;
      crm[localPhone].businessType = 'beauty';
      added++;
    }
  });

  if (added > 0) {
    saveCRM(crm);
    console.log(`✅ lee API sync — נוספו ${added} תורים (Lee החזיר סה"כ ${appointments.length})`);
  } else {
    console.log(`ℹ️ lee API sync — הכל מעודכן (Lee: ${appointments.length} תורים, הכל כבר ב-CRM)`);
  }
  return { added, total: appointments.length };
}

// ── סנכרון lee אוטומטי (כל 2 שעות) — דרך API Key ────────────
async function syncLeeCalendar() {
  const LEE_API_KEY     = process.env.LEE_API_KEY;
  const LEE_BUSINESS_ID = process.env.LEE_BUSINESS_ID || '64c638d114964';

  // אם יש API Key — שתמש בו במקום Puppeteer
  if (LEE_API_KEY) {
    return await syncLeeViaAPI(LEE_API_KEY, LEE_BUSINESS_ID);
  }

  const LEE_EMAIL = process.env.LEE_EMAIL;
  const LEE_PASS  = process.env.LEE_PASS;

  if (!LEE_EMAIL || !LEE_PASS) {
    console.log('⚠️ lee sync — הגדר LEE_API_KEY ב-.env לסנכרון תורים');
    return;
  }
  if (!client.pupBrowser) {
    console.log('⚠️ lee sync — WhatsApp לא מחובר עדיין');
    return;
  }

  let page;
  try {
    page = await client.pupBrowser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setDefaultNavigationTimeout(30000);

    // לכוד תשובות JSON מ-Lee שמכילות תורים
    let capturedEvents = [];
    page.on('response', async (response) => {
      const url = response.url();
      const ct  = response.headers()['content-type'] || '';
      if (!ct.includes('json') || !url.includes('lee.co.il')) return;
      try {
        const json = await response.json();
        const arr = Array.isArray(json) ? json
                  : (json.data || json.events || json.appointments || json.items || []);
        if (Array.isArray(arr) && arr.length > 0) {
          const sample = arr[0];
          const hasDate = sample.start || sample.date || sample.startTime || sample.appointmentDate;
          if (hasDate) capturedEvents = capturedEvents.concat(arr);
        }
      } catch(e) {}
    });

    // ── שלב 1: כניסה ──────────────────────────────────────────
    await page.goto('https://app.lee.co.il/office/login.php', { waitUntil: 'networkidle2' });

    const filled = await page.evaluate((email, pass) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      let emailField = null, passField = null;
      inputs.forEach(inp => {
        const type = (inp.type || '').toLowerCase();
        const name = (inp.name || '').toLowerCase();
        const id   = (inp.id   || '').toLowerCase();
        const ph   = (inp.placeholder || '').toLowerCase();
        if (!emailField && (type === 'email' || name.includes('email') || name.includes('user') ||
            id.includes('email') || ph.includes('מייל') || ph.includes('email') || ph.includes('user'))) {
          emailField = inp;
        }
        if (!passField && type === 'password') passField = inp;
      });
      if (emailField) {
        emailField.value = email;
        emailField.dispatchEvent(new Event('input', { bubbles: true }));
        emailField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (passField) {
        passField.value = pass;
        passField.dispatchEvent(new Event('input', { bubbles: true }));
        passField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { emailFilled: !!emailField, passFilled: !!passField };
    }, LEE_EMAIL, LEE_PASS);

    if (!filled.emailFilled || !filled.passFilled) {
      console.log('⚠️ lee sync — לא נמצאו שדות לוגין בדף');
      return;
    }

    // לחץ כפתור כניסה
    await page.evaluate(() => {
      const btn = document.querySelector(
        'button[type="submit"], input[type="submit"], [class*="login"] button, form button:last-child'
      );
      if (btn) btn.click();
      else { const f = document.querySelector('form'); if (f) f.submit(); }
    });

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

    // בדוק כניסה
    const afterLoginUrl = page.url();
    if (afterLoginUrl.includes('login') || afterLoginUrl.includes('signin')) {
      console.log('⚠️ lee sync — כניסה נכשלה — בדוק LEE_EMAIL/LEE_PASS ב-.env');
      return;
    }
    console.log('✅ lee login — מחובר בהצלחה');

    // ── שלב 2: טען לוח שנה ───────────────────────────────────
    // טווח: החודש הנוכחי + 2 חודשים קדימה
    const now   = new Date();
    const start = now.toISOString().split('T')[0];
    const end   = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString().split('T')[0];
    await page.goto(
      `https://app.lee.co.il/office/calendar.php?start=${start}&end=${end}`,
      { waitUntil: 'domcontentloaded' }
    );
    await new Promise(r => setTimeout(r, 5000)); // תן ל-FullCalendar לטעון

    // נסה window API של FullCalendar
    const windowEvents = await page.evaluate(() => {
      try {
        const cal = window.calendarMain || window.newCalendarInstance ||
                    window.fc || (typeof FullCalendar !== 'undefined' && document.querySelector('.fc') ?
                    FullCalendar.getCalendarFromEl(document.querySelector('.fc')) : null);
        if (cal && cal.getEvents) {
          return cal.getEvents().map(e => ({
            start:   e.start ? e.start.toISOString() : null,
            end:     e.end   ? e.end.toISOString()   : null,
            title:   e.title || (e._def && e._def.title),
            name:    (e.extendedProps && (e.extendedProps.customer_name || e.extendedProps.clientName ||
                      (e.extendedProps.customer && e.extendedProps.customer.name))) || null,
            phone:   (e.extendedProps && (e.extendedProps.customer_phone || e.extendedProps.clientPhone ||
                      (e.extendedProps.customer && e.extendedProps.customer.phone))) || null,
            service: (e.extendedProps && (e.extendedProps.service || e.extendedProps.treatment || e.extendedProps.serviceName)) || null,
            status:  (e.extendedProps && e.extendedProps.status) || null,
          }));
        }
        // DOM fallback — קרא מהאלמנטים
        const items = [];
        document.querySelectorAll('.fc-event, [data-appointment-id], [class*="appointment"]').forEach(el => {
          const s = el.dataset.start || el.getAttribute('data-start') || el.getAttribute('data-date');
          const t = el.querySelector('.fc-title, .fc-event-title') || el;
          if (s) items.push({ start: s, title: t.textContent.trim() });
        });
        return items;
      } catch(e) { return [{ error: e.message }]; }
    });

    // שלב תוצאות
    const allEvents = [...capturedEvents, ...windowEvents.filter(e => !e.error)];

    if (!allEvents.length) {
      const errs = windowEvents.filter(e => e.error);
      console.log('⚠️ lee sync — לא נמצאו תורים' + (errs.length ? ': ' + errs[0].error : ''));
      return;
    }

    // ── שלב 3: שמור ב-CRM ─────────────────────────────────────
    const crm = loadCRM();
    let added = 0;
    allEvents.forEach(evt => {
      const dateStr  = evt.start || evt.date || evt.startTime || evt.appointmentDate;
      const rawPhone = (evt.phone || evt.customerPhone || evt.clientPhone || '').replace(/\D/g, '');
      if (!dateStr || !rawPhone) return;

      let localPhone = rawPhone;
      if (localPhone.startsWith('972')) localPhone = '0' + localPhone.slice(3);
      if (localPhone.length < 9) return;

      const d = new Date(dateStr);
      if (isNaN(d)) return;
      const iso = d.toISOString();
      const service = evt.service || evt.serviceName || evt.treatment || evt.title || 'טיפול';

      if (!crm[localPhone]) {
        crm[localPhone] = { phone: localPhone, name: evt.name || evt.customerName || 'לקוחה',
                            firstContact: iso, visits: [], source: 'lee', businessType: 'beauty' };
      }
      crm[localPhone].visits = crm[localPhone].visits || [];
      if (!crm[localPhone].visits.some(v => v.date === iso && v.service === service)) {
        crm[localPhone].visits.push({ date: iso, service, source: 'lee',
          status: evt.status === '2' || evt.status === 'done' ? 'done' : 'scheduled' });
        if (evt.name || evt.customerName) crm[localPhone].name = evt.name || evt.customerName;
        crm[localPhone].lastService = service;
        crm[localPhone].businessType = 'beauty';
        added++;
      }
    });

    if (added > 0) {
      saveCRM(crm);
      console.log(`✅ lee sync — נוספו ${added} תורים (${allEvents.length} אירועים בסה"כ)`);
    } else {
      console.log(`ℹ️ lee sync — ${allEvents.length} אירועים נמצאו, אין חדשים`);
    }
    return added;

  } catch(e) {
    console.log('⚠️ lee sync שגיאה:', e.message);
    throw e;
  } finally {
    if (page) try { await page.close(); } catch(e2) {}
  }
}

function startLeeSyncJob() {
  // ריצה ראשונה אחרי 2 דקות
  setTimeout(syncLeeCalendar, 2 * 60 * 1000);
  // כל 2 שעות
  setInterval(syncLeeCalendar, 2 * 60 * 60 * 1000);
}

function startWeeklySlotReminder() {
  setInterval(async () => {
    const now = new Date();
    const israelHour = getIsraelHour();
    const dayOfWeek = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' });

    // ראשון בשעה 9:00 — תזכורת תורים + סיכום שבועי
    if (dayOfWeek === 'Sun' && israelHour === 9) {
      const available = getAvailableSlots();
      const crm = loadCRM();
      const allCustomers = Object.values(crm);
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const newThisWeek = allCustomers.filter(c => c.firstContact && new Date(c.firstContact).getTime() > oneWeekAgo).length;
      const appointmentsThisWeek = allCustomers.filter(c => c.pendingAppointmentRequest && c.lastSeen && new Date(c.lastSeen).getTime() > oneWeekAgo).length;
      const photosThisWeek = allCustomers.filter(c => c.lastPhotoSent && new Date(c.lastPhotoSent).getTime() > oneWeekAgo).length;

      try {
        await client.sendMessage(JULIET_NUMBER,
          `☀️ *שבוע טוב יוליה!* 💎\n\n` +
          `📊 *סיכום השבוע שעבר:*\n` +
          `👩 לקוחות חדשות: *${newThisWeek}*\n` +
          `📅 בקשות תור: *${appointmentsThisWeek}*\n` +
          `📸 תמונות שנשלחו: *${photosThisWeek}*\n` +
          `👥 סה"כ לקוחות ב-CRM: *${allCustomers.length}*\n\n` +
          `${available.length > 0
            ? `📅 *תורים פנויים לשבוע:* ${available.length}\n` +
              available.slice(0, 5).map((s, i) => `${i + 1}. ${s.label}`).join('\n')
            : `⚠️ *אין תורים פנויים!* לקוחות לא יוכלו לקבוע.`
          }\n\n` +
          `📝 להוספת תורים:\n\`פנויים\n` +
          `ראשון 10:00\nשלישי 14:00\`\n` +
          `_(כל שורה = תור אחד)_`
        );
        console.log('📅 נשלח סיכום שבועי לג\'ולייט');
      } catch(e) {
        console.log('שגיאה בסיכום שבועי:', e.message);
      }
    }
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

// ── דו"ח בוקר יומי — כל יום ב-09:00 ────────────────────────
let lastMorningReport = '';
function startDailyMorningReport() {
  setInterval(async () => {
    const now = new Date();
    const israelTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const hour = israelTime.getHours();
    const todayKey = israelTime.toISOString().split('T')[0];

    if (hour !== 9 || lastMorningReport === todayKey) return;
    lastMorningReport = todayKey;

    try {
      const crm = loadCRM();
      const allCustomers = Object.values(crm);
      const todayStart = new Date(israelTime);
      todayStart.setHours(0,0,0,0);
      const todayEnd   = new Date(israelTime);
      todayEnd.setHours(23,59,59,999);

      // תורים להיום מ-visits[]
      const todayAppts = [];
      allCustomers.forEach(c => {
        (c.visits || []).forEach(v => {
          if (!v.date || v.status === 'done') return;
          const d = new Date(v.date);
          if (d >= todayStart && d <= todayEnd) {
            todayAppts.push({ name: c.name || 'לקוחה', phone: c.phone, time: d.toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}), service: v.service || '' });
          }
        });
        // pendingAppointment
        if (c.pendingAppointment) {
          const d = new Date(c.pendingAppointment);
          if (d >= todayStart && d <= todayEnd) {
            todayAppts.push({ name: c.name || 'לקוחה', phone: c.phone, time: d.toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'}), service: c.lastService || '' });
          }
        }
      });
      todayAppts.sort((a,b) => a.time.localeCompare(b.time));

      // בקשות מחיר ממתינות
      const pendingPrices = allCustomers.filter(c => c.pendingPriceRequest &&
        (Date.now() - new Date(c.pendingPriceRequest.date).getTime()) < 48*3600000
      );

      // לידים חמים ללא מענה
      const hotLeads = allCustomers.filter(c => c.leadStatus === 'hot' && c.leadDate &&
        (Date.now() - new Date(c.leadDate).getTime()) < 48*3600000
      );

      // לקוחות שפנו אתמול ולא ענית להן ידנית (chatLog רק מ-customer, ב-24 שעות אחרונות)
      const yesterday = Date.now() - 24 * 3600000;
      const unanswered = allCustomers.filter(c => {
        if (!c.chatLog || c.chatLog.length === 0) return false;
        const lastCustomerMsg = [...c.chatLog].reverse().find(h => h.from === 'customer');
        if (!lastCustomerMsg) return false;
        const msgTime = new Date(lastCustomerMsg.time).getTime();
        if (msgTime < yesterday) return false;
        // בדוק שאין הודעה של ג'ולייט אחרי ההודעה האחרונה של הלקוחה
        const lastJulietMsg = [...c.chatLog].reverse().find(h => h.from === 'juliet');
        if (lastJulietMsg && new Date(lastJulietMsg.time).getTime() > msgTime) return false;
        return true;
      });

      // סיכום אתמול — כמה לקוחות פנו
      const yesterdayStart = Date.now() - 48 * 3600000;
      const yesterdayCustomers = allCustomers.filter(c => {
        if (!c.lastSeen) return false;
        const t = new Date(c.lastSeen).getTime();
        return t > yesterdayStart && t < yesterday;
      });

      // בניית ההודעה
      let msg = `☀️ *בוקר טוב יוליה!* 💎\n\n`;
      msg += `📊 *דו"ח יומי — ${todayEnd.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}*\n\n`;

      if (todayAppts.length > 0) {
        msg += `📅 *תורים להיום (${todayAppts.length}):*\n`;
        todayAppts.forEach(a => {
          msg += `• ${a.time} — *${a.name}* (${a.phone}) ${a.service ? '| ' + a.service : ''}\n`;
        });
      } else {
        msg += `📅 אין תורים רשומים להיום\n`;
      }

      if (unanswered.length > 0) {
        msg += `\n⚠️ *לקוחות שפנו ולא קיבלו מענה (${unanswered.length}):*\n`;
        unanswered.slice(0,5).forEach(c => {
          const lastMsg = [...c.chatLog].reverse().find(h => h.from === 'customer');
          msg += `• *${c.name || c.phone}* — "${(lastMsg?.text || '').substring(0,30)}..."\n  👉 https://wa.me/972${(c.phone||'').replace(/^0/,'')}\n`;
        });
      }

      if (yesterdayCustomers.length > 0) {
        msg += `\n📈 *אתמול פנו:* ${yesterdayCustomers.length} לקוחות\n`;
      }

      if (pendingPrices.length > 0) {
        msg += `\n💰 *מחכות למחיר (${pendingPrices.length}):*\n`;
        pendingPrices.slice(0,5).forEach(c => {
          msg += `• *${c.name || c.phone}* — ${c.pendingPriceRequest?.service || ''}\n`;
        });
      }

      if (hotLeads.length > 0) {
        msg += `\n🔥 *לידים חמים (${hotLeads.length}):*\n`;
        hotLeads.slice(0,3).forEach(c => {
          msg += `• *${c.name || c.phone}* https://wa.me/972${(c.phone||'').replace(/^0/,'')}\n`;
        });
      }

      msg += `\n👥 סה"כ לקוחות: *${allCustomers.length}*`;
      msg += `\n\n_יום נהדר!_ 💫`;

      await client.sendMessage(JULIET_NUMBER, msg);
      console.log('☀️ דו"ח בוקר נשלח');
    } catch(e) {
      console.log('שגיאה בדו"ח בוקר:', e.message);
    }
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

function startReminderJob() {
  setInterval(async () => {
    try {
      const now = Date.now();
      const israelHour = getIsraelHour();
      const tomorrowKey = getIsraelTomorrowKey();
      const todayKey    = getIsraelTodayKey();
      const crm = loadCRM();

      for (const [phone, customer] of Object.entries(crm)) {
        if (customer.muted) continue;

        // ── תזכורות + ביקורות מ-visits[] (lee + CRM) ───────────
        if (Array.isArray(customer.visits)) {
          let changed = false;

          for (const visit of customer.visits) {
            if (!visit.date) continue;
            const visitDateKey = visit.date.slice(0, 10); // YYYY-MM-DD
            const apptTime = new Date(visit.date).getTime();

            // ── תזכורת בין 10:00-11:59 עבור תורים של מחר ────────
            // visitDateKey בזמן ישראל (לא UTC)
            const visitIsraelDate = new Date(new Date(visit.date).toLocaleString('en-US',{timeZone:'Asia/Jerusalem'}));
            const visitIsraelKey = `${visitIsraelDate.getFullYear()}-${String(visitIsraelDate.getMonth()+1).padStart(2,'0')}-${String(visitIsraelDate.getDate()).padStart(2,'0')}`;
            // דלג על lee_ כי אין להן מספר WhatsApp
            const isLeePhone = phone.startsWith('lee_');
            if (!visit.reminderSent && israelHour >= 10 && israelHour < 20 && visitIsraelKey === tomorrowKey && !isLeePhone) {
              const name = customer.name || 'יקרה';
              const firstName = name.split(' ')[0];
              const apptStr = new Date(visit.date).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
              const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
              let msg;
              if (hasCity(name)) {
                msg = `היי ${firstName}! 💎\n\n` +
                  `תזכורת לתור מחר ב-*${apptStr}*${visit.service ? ` — *${visit.service}*` : ''} אצל *Juliet Beauty Boutique* 💇‍♀️\n\n` +
                  `📍 *כתובת הסלון:*\n${SALON_ADDRESS}\n\n` +
                  `✨ מכיוון שאת מגיעה מרחוק — תרצי לשלוח לי את הכתובת המדויקת שלך? אדאג שיהיה לך קל להגיע 📍\n\n` +
                  `מחכה לך! 💫`;
              } else {
                msg = `היי ${firstName}! 💎\n\n` +
                  `תזכורת לתור מחר ב-*${apptStr}*${visit.service ? ` — *${visit.service}*` : ''} אצל *Juliet Beauty Boutique* 💇‍♀️\n\n` +
                  `📍 *כתובת:*\n${SALON_ADDRESS}\n\n` +
                  `אם צריך לשנות — שלחי הודעה 🙏\nמחכה לך! 💫`;
              }
              try {
                await client.sendMessage(chatId, msg);
                visit.reminderSent = true;
                visit.reminderSentDate = getIsraelTodayKey();
                changed = true;
                console.log(`📅 תזכורת נשלחה ל-${customer.name || phone} לתור ${visitIsraelKey}`);
                await new Promise(r => setTimeout(r, 1500));
              } catch(e) { console.log('שגיאת תזכורת:', e.message); }
            }

            // ── ביקורת ב-20:00 אחרי תור שעבר (היום / אתמול) ───
            if (!visit.reviewSent && israelHour === 20 && apptTime < now) {
              const hoursSince = (now - apptTime) / 3600000;
              if (hoursSince >= 2 && hoursSince <= 30) {
                const name = customer.name || 'יקרה';
                const firstName = name.split(' ')[0];
                try {
                  const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
                  await client.sendMessage(chatId,
                    `${firstName}! 💎 איך השיער מרגיש היום?\n\n` +
                    `שמחה שהיית אצלי 🤍\n\n` +
                    `ביקורת קטנה שלך עוזרת לי להגיע לעוד נשים מדהימות 🙏\n\n` +
                    `⭐ *גוגל (מומלץ!):*\n${GOOGLE_REVIEW_LINK}\n\n` +
                    `_תודה מהלב, את הכי טובה!_ 💎`
                  );
                  visit.reviewSent = true;
                  changed = true;
                  console.log(`⭐ ביקורת נשלחה ל-${customer.name || phone}`);
                } catch(e) {}
              }
            }

            // ── חידוש שורשים 6 חודשים אחרי ──────────────────
            if (!visit.renewalSent && apptTime < now) {
              const daysSince = (now - apptTime) / 86400000;
              if (daysSince >= 180 && daysSince <= 195) {
                const name = customer.name || 'יקרה';
                const firstName = name.split(' ')[0];
                try {
                  const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
                  await client.sendMessage(chatId,
                    `היי ${firstName}! 💎\n\n` +
                    `עברו כבר *6 חודשים* מה${visit.service || 'טיפול'} שלך 🌿\n\n` +
                    `הגיע הזמן לחדש שורשים! זוכרת כמה יצא יפה? 😊\n\n` +
                    `כתבי *"קביעה"* ונסדר לך תור בהקדם 💎`
                  );
                  visit.renewalSent = true;
                  changed = true;
                  console.log(`🌿 תזכורת חידוש נשלחה ל-${customer.name || phone}`);
                } catch(e) {}
              }
            }
          }
          if (changed) saveCRM(crm);
        }

        // ── pendingAppointment (קביעה ידנית) ──────────────────
        if (!customer.pendingAppointment) continue;
        const apptTime   = new Date(customer.pendingAppointment).getTime();
        const hoursUntil = (apptTime - now) / 3600000;
        const apptDateKey = customer.pendingAppointment.slice(0, 10);

        // תזכורת ב-10:00 ליום מחר
        if (!customer.reminderSent && israelHour === 10 && apptDateKey === tomorrowKey) {
          const name = customer.name || 'יקרה';
          const firstName = name.split(' ')[0];
          const apptStr = new Date(customer.pendingAppointment).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });
          let msg;
          if (hasCity(name)) {
            msg = `היי ${firstName}! 💎\n\nתזכורת לתור מחר ב-*${apptStr}* אצל *Juliet Beauty Boutique* 💇‍♀️\n\n📍 *כתובת הסלון:*\n${SALON_ADDRESS}\n\n✨ מכיוון שאת מגיעה מרחוק — תרצי לשלוח לי את הכתובת המדויקת שלך? אדאג שיהיה לך קל להגיע 📍\n\nמחכה לך! 💫`;
          } else {
            msg = `היי ${firstName}! 💎\n\nתזכורת לתור מחר ב-*${apptStr}* אצל *Juliet Beauty Boutique* 💇‍♀️\n\n📍 *כתובת:*\n${SALON_ADDRESS}\n\nאם צריך לשנות — שלחי הודעה 🙏\nמחכה לך! 💫`;
          }
          try {
            const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
            await client.sendMessage(chatId, msg);
            crm[phone].reminderSent = true;
            saveCRM(crm);
            console.log(`📅 תזכורת 10:00 (pending) נשלחה ל-${customer.name || phone}`);
          } catch(e) {}
        }

        // ביקורת ב-20:00 אחרי תור שעבר
        if (!customer.reviewSent && israelHour === 20 && hoursUntil < 0) {
          const hoursSince = Math.abs(hoursUntil);
          if (hoursSince >= 2 && hoursSince <= 30) {
            const name = customer.name || 'יקרה';
            const firstName = name.split(' ')[0];
            try {
              const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
              await client.sendMessage(chatId,
                `${firstName}! 💎 איך השיער מרגיש היום?\n\n` +
                `שמחה שהיית אצלי 🤍\n\n` +
                `ביקורת קטנה שלך עוזרת לי להגיע לעוד נשים מדהימות 🙏\n\n` +
                `⭐ *גוגל (מומלץ!):*\n${GOOGLE_REVIEW_LINK}\n\n` +
                `_תודה מהלב, את הכי טובה!_ 💎`
              );
              crm[phone].reviewSent = true;
              saveCRM(crm);
              console.log(`⭐ ביקורת (pending) נשלחה ל-${customer.name || phone}`);
            } catch(e) {}
          }
        }

        // תזכורת חידוש שורשים 7 חודשים אחרי
        const daysSinceAppt = (now - apptTime) / 86400000;
        if (daysSinceAppt >= 200 && daysSinceAppt <= 215 && !customer.rootsReminderSent) {
          const name = customer.name || 'יקרה';
          const firstName = name.split(' ')[0];
          try {
            const chatId = '972' + phone.replace(/^0/, '') + '@c.us';
            await client.sendMessage(chatId,
              `היי ${firstName}! 💎\n\nעברו כבר *7 חודשים* מהטיפול שלך — הגיע הזמן לחדש שורשים! 🌿\n\nזוכרת כמה יצא יפה? 😊\n\nכתבי *"קביעה"* ונסדר לך תור בהקדם 💎`
            );
            crm[phone].rootsReminderSent = true;
            saveCRM(crm);
            console.log(`🌿 תזכורת שורשים נשלחה ל-${customer.name || phone}`);
          } catch(e) {}
        }
      }

      // ── בדיקת תזכורות אישיות ──────────────────────────────────
      const personalReminders = loadReminders();
      let reminderChanged = false;
      for (const rem of personalReminders) {
        if (rem.sent) continue;
        const remTime = new Date(rem.datetime).getTime();
        if (remTime <= now) {
          // שלח תזכורת לג'ולייט
          try {
            let msg = `🔔 *תזכורת אישית:*\n\n${rem.text}`;
            if (rem.phone) {
              const crm = loadCRM();
              const custName = (crm[rem.phone] && crm[rem.phone].name) || rem.phone;
              msg += `\n\n👤 לקוחה: *${custName}*`;
            }
            await client.sendMessage(JULIET_NUMBER, msg);
            rem.sent = true;
            reminderChanged = true;
            console.log('🔔 תזכורת אישית נשלחה:', rem.text.slice(0,40));
          } catch(e) { console.log('שגיאת תזכורת אישית:', e.message); }
        }
      }
      if (reminderChanged) saveReminders(personalReminders);

    } catch(e) {
      console.log('שגיאה ב-startReminderJob:', e.message);
    }
  }, 60 * 60 * 1000); // בדיקה כל שעה
}

client.on('ready', () => {
  clientReady = true;
  currentQR = null; // נקה QR ישן
  console.log('\n✅ הבוט של ג\'וליאט פעיל! 💎\n');
  console.log('לקוחות שכותבות "היי" יקבלו תפריט אוטומטי\n');
  try { console.log('📱 מחובר כ:', client.info.wid.user); } catch(e) {}
  // סרוק הודעות עבר לזיהוי שירותים
  setTimeout(scanPastMessages, 5000);
  // הפעל תזכורות תורים
  startReminderJob();
  // תזכורת שבועית לג'ולייט
  startWeeklySlotReminder();
  // ברכות חגים אוטומטיות
  startHolidayGreetings();
  // גיבוי יומי לוקאלי
  startDailyBackup();
  // גיבוי אוטומטי ל-GitHub כל לילה
  startGithubBackupJob();
  // גיבוי ראשוני ל-GitHub עם עלייה (אחרי 10 שניות)
  setTimeout(backupToGithub, 10000);
  // דו"ח בוקר יומי
  startDailyMorningReport();
  // סנכרון lee כל 2 שעות
  startLeeSyncJob();

  // ✅ חסימה מלאה של סטורי/סטטוס — לא צופה, לא מעדכנת
  try {
    client.pupPage.evaluate(() => {
      // ביטול מנוי לנוכחות
      if (window.WAPI) {
        window.WAPI.unsubscribePresence && window.WAPI.unsubscribePresence();
        // חסימת עדכון סטטוס
        window.WAPI.setPresence && window.WAPI.setPresence(false);
      }
      // מניעת צפייה אוטומטית בסטורי
      if (window.Store && window.Store.StatusUtils) {
        window.Store.StatusUtils.sendReadStatus = () => Promise.resolve();
      }
    }).catch(() => {});
  } catch(e) {}
});

// ✅ התעלם לחלוטין מכל אירוע סטורי/סטטוס
client.on('message_create', (msg) => {
  if (msg.from === 'status@broadcast' || msg.isStatus || (msg.from && msg.from.includes('broadcast'))) return;
});

// ✅ מניעת עדכון "נצפה" על סטורי
client.on('message', (msg) => {
  if (msg.from === 'status@broadcast' || msg.isStatus) return;
});

// ✅ אירוע סטטוס — התעלם לחלוטין
try {
  client.on('message_reaction', () => {});
} catch(e) {}

// ✅ מחיקת הודעה — אל תגיב, אל תעשה כלום
try { client.on('message_revoke_for_everyone', () => {}); } catch(e) {}
try { client.on('message_revoke_for_me', () => {}); } catch(e) {}

client.on('auth_failure', () => {
  console.log('❌ שגיאת חיבור — נסי שוב');
});

client.on('disconnected', async (reason) => {
  clientReady = false;
  console.log('❌ הבוט התנתק:', reason);
  const disconnectTime = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  fs.writeFileSync(path.join(__dirname, 'disconnected.txt'), new Date().toISOString() + ': ' + reason);
  // שליחת אימייל התראה
  await sendDisconnectEmail(reason);
  // הפעלה מחדש אוטומטית אחרי 15 שניות
  setTimeout(() => {
    console.log('🔄 מנסה להתחבר מחדש...');
    try { client.initialize(); } catch(e) { console.log('שגיאה ב-initialize:', e.message); }
  }, 15000);
});

client.initialize();