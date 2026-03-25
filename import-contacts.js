const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const CRM_FILE = path.join(__dirname, 'customers.json');

function loadCRM() {
  if (!fs.existsSync(CRM_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CRM_FILE, 'utf8')); } catch(e) { return {}; }
}

function saveCRM(data) {
  fs.writeFileSync(CRM_FILE, JSON.stringify(data, null, 2));
  console.log(`\n💾 נשמר — ${Object.keys(data).length} לקוחות במערכת`);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'juliet-menu-bot' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', (qr) => {
  console.log('\n💎 סרקי את ה-QR:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('\n✅ מחובר! מתחיל לייבא אנשי קשר...\n');
  const crm = loadCRM();
  let imported = 0;
  let skipped = 0;

  try {
    const chats = await client.getChats();
    console.log(`📋 נמצאו ${chats.length} שיחות — סורק...`);

    for (const chat of chats) {
      // דלג על קבוצות
      if (chat.isGroup) { skipped++; continue; }

      const contact = await chat.getContact();
      const phone = contact.number || chat.id.user;
      const cleanPhone = '0' + phone.replace('972', '');

      // שם — מספר טלפון / שם אנשי קשר
      const name = contact.pushname || contact.name || null;

      // דלג על מספרים לא ישראליים או לא חוקיים
      if (!phone || phone.length < 9) { skipped++; continue; }

      // שמור ב-CRM
      if (!crm[cleanPhone]) {
        crm[cleanPhone] = {
          phone: cleanPhone,
          name: name || null,
          firstContact: new Date().toISOString(),
          lastSeen: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : new Date().toISOString(),
          visits: [],
          source: 'import'
        };
        imported++;
        console.log(`  ✦ ${cleanPhone} ${name ? '— ' + name : '(ללא שם)'}`);
      } else {
        // עדכן שם אם חסר
        if (!crm[cleanPhone].name && name) {
          crm[cleanPhone].name = name;
          console.log(`  🔄 עודכן שם: ${cleanPhone} — ${name}`);
        }
        skipped++;
      }
    }

    saveCRM(crm);
    console.log(`\n🎉 ייבוא הושלם!`);
    console.log(`   ✅ נוספו: ${imported} לקוחות חדשים`);
    console.log(`   ⏭  דולגו: ${skipped} (כפולים / קבוצות)`);
    console.log(`   💎 סה"כ במערכת: ${Object.keys(crm).length} לקוחות\n`);

  } catch(e) {
    console.error('שגיאה:', e.message);
  }

  console.log('✅ סגרי את החלון הזה ופתחי את הבוט הרגיל: npm start');
  process.exit(0);
});

client.on('auth_failure', () => {
  console.log('❌ שגיאת חיבור');
  process.exit(1);
});

client.initialize();
