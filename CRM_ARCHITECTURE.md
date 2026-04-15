# 🏗️ CRM ARCHITECTURE — Juliet Universe

---

## 📦 מבנה נתוני לקוחה (`customers.json`)

```json
{
  "0501234567": {
    "phone": "0501234567",
    "name": "שם לקוחה",
    "firstContact": "2026-01-01T10:00:00.000Z",
    "lastSeen": "2026-04-10T14:00:00.000Z",
    "vip": false,
    "muted": false,
    "leadStatus": "hot | cold | null",
    "businessType": "beauty | universe | null",
    "interestedIn": "החלקה | תוספות | צבע | null",
    "lastService": "החלקת שורש",
    "notes": {
      "color": "גוון 7 אפר",
      "allergy": "רגישה לניקל",
      "general": "הערות חופשיות"
    },
    "chatLog": [
      { "from": "customer|juliet", "text": "...", "time": "ISO" }
    ],
    "visits": [
      {
        "date": "2026-04-15T07:00:00.000Z",
        "service": "החלקת שורש",
        "status": "scheduled | done | cancelled",
        "source": "crm | lee | manual",
        "visitIndex": 0,
        "reminderSent": false,
        "reviewSent": false,
        "renewalSent": false,
        "followUpSent": false,
        "confirmed": false
      }
    ],
    "pendingAppointment": "2026-04-15T07:00:00.000Z",
    "pendingAppointmentSource": "crm | lee",
    "reminderSent": false,
    "reviewSent": false,
    "rootsReminderSent": false,
    "lastPhotoSent": "ISO"
  }
}
```

---

## 🔄 זרימת הודעה נכנסת מלקוחה

```
לקוחה שולחת הודעה
        ↓
client.on('message')
        ↓
[התעלם מ: קבוצות / סטורי / fromMe]
        ↓
[בוט שותק? ג'ולייט טיפלה ב-3 שעות אחרונות?] → כן → שמור לוג בלבד
        ↓ לא
[✅/❌ אישור/ביטול תור?] → כן → עדכן CRM + הודע לג'ולייט
        ↓ לא
[תמונה?] → העבר לג'ולייט + אשר ללקוחה
        ↓ לא
[שמור לוג שיחה ב-chatLog]
        ↓
[היעדרות פעילה?] → כן → הודעת היעדרות (פעם אחת)
        ↓ לא
[מחוץ לשעות פעילות 9:00–22:00?] → כן → הודעת סגור (פעם אחת)
        ↓ לא
[ברכה / "היי" / חזרה לתפריט?] → MAIN_MENU עם זיכרון שם
        ↓ לא
[לוגיקת תפריט לפי userState.step]
        ↓
שמור עדכון ב-CRM (updateCustomer)
```

---

## 📡 API Endpoints

### ציבוריים (ללא סיסמה)
| Method | Path | תיאור |
|--------|------|--------|
| GET | `/` | health check |
| GET | `/health` | סטטוס בוט + WA |
| GET | `/qr` | דף QR לסריקה |
| GET | `/reset-session` | מחיקת סשן + restart |

### מאובטחים (`?pass=juliet2026`)
| Method | Path | תיאור |
|--------|------|--------|
| GET | `/crm` | ממשק CRM |
| GET | `/customers.json` | כל נתוני הלקוחות |
| POST | `/save-appointment` | שמירת תור חדש |
| POST | `/save-note` | שמירת הערות לקוחה |
| POST | `/delete-customer` | מחיקת לקוחה |
| POST | `/send-reminders-now` | שליחת תזכורות מיידית |
| POST | `/send-bulk` | שידור קבוצתי |
| GET | `/reminder-status` | סטטוס תזכורות מחר |
| GET | `/status` | JSON סטטוס מלא |
| POST | `/backup-now` | גיבוי ל-GitHub |
| GET | `/backup-status` | סטטוס גיבוי |
| GET/POST | `/waitlist` | רשימת המתנה |
| POST | `/add-waitlist` | הוספה לרשימת המתנה |
| POST | `/remove-waitlist` | הסרה מרשימת המתנה |
| POST | `/notify-waitlist` | שליחת הודעה ממתינה |
| POST | `/save-reminder` | תזכורת אישית |
| GET | `/customer-card/:phone` | כרטיס לקוחה HTML |
| POST | `/save-photo` | שמירת תמונה לקוחה |
| GET | `/get-photo` | שליפת תמונה |

### Lee Calendar Webhook
| Method | Path | תיאור |
|--------|------|--------|
| POST | `/lee-webhook` | קבלת תורים מ-Lee |
| GET | `/sync-lee` | סנכרון ידני |
| GET | `/sync-lee-status` | סטטוס סנכרון |

---

## ⏰ Jobs אוטומטיים

| Job | מתי רץ | מה עושה |
|-----|--------|---------|
| `startReminderJob` | כל שעה | שולח תזכורות 10:00–20:00 לתורים של מחר |
| `startReminderJob` | כל שעה | ביקורת גוגל ב-20:00 אחרי תור |
| `startReminderJob` | כל שעה | follow-up ב-19:00 אחרי תור |
| `startReminderJob` | כל שעה | תזכורת חידוש שורשים 7 חודשים |
| `startGithubBackupJob` | 4:00 בלילה | גיבוי ל-GitHub |
| `startWeeklySlotReminder` | ראשון 8:00 | תזכורת לג'ולייט לעדכן תורים פנויים |
| `startDailyMorningReport` | 8:00 בבוקר | דוח יומי לג'ולייט |
| `startLeeSyncJob` | כל 2 שעות | סנכרון lee |

---

## 🗂️ מבנה תיקיות

```
JULIET-AI-V2/
├── juliet-menu-bot.js      # הבוט הראשי
├── crm.html                # ממשק CRM
├── package.json
├── PROJECT_MEMORY.md       # זיכרון פרויקט (קובץ זה)
├── CRM_ARCHITECTURE.md     # ארכיטקטורה
└── /data/                  # Railway Volume (persistent)
    ├── customers.json
    ├── reminders.json
    ├── waitlist.json
    ├── slots.json
    └── .wwebjs_auth/       # סשן WhatsApp
```

---

## 🔑 משתני סביבה ב-Railway

| משתנה | ערך | חובה? |
|-------|-----|-------|
| `CRM_PASSWORD` | juliet2026 | כן |
| `ANTHROPIC_API_KEY` | sk-... | כן (Claude AI) |
| `GITHUB_TOKEN` | ghp_... | לגיבוי אוטומטי |
| `GITHUB_REPO` | julietesemenyuk-sudo/juliet-bot | לגיבוי |
| `NTFY_TOPIC` | juliet-bot-alerts-5865 | התראות ניתוק |
| `LEE_API_KEY` | ... | סנכרון lee |

---

## ⚠️ בעיות ידועות ופתרונות

| בעיה | סיבה | פתרון |
|------|------|-------|
| סשן WA נמחק אחרי restart | Railway Volume לא מחובר | לוודא Volume על `/data` |
| iOS modal לא מכסה מסך | `overflow-x:hidden` על `body` | הועבר ל-`html` |
| תור נשמר בשעה לא נכונה | `new Date(date+'T'+time)` = UTC | `Date.UTC(yr,mo-1,dy,hr-3,mn,0)` |
| SALON_ADDRESS לא מוגדר בעת קריאה | `const` לא hoisted | `httpSendReminders()` קראת אחרי setTimeout |
