# 💎 PROJECT MEMORY — Juliet Universe Bot & CRM

> קובץ זה מתעדכן אוטומטית לאחר כל שינוי משמעותי.
> **בתחילת כל סשן — קרא קובץ זה ואת CRM_ARCHITECTURE.md לפני כל פעולה.**

---

## 🏗️ מה בנינו עד כה

### מערכת כוללת
- **בוט וואטסאפ** (`juliet-menu-bot.js`) — רץ על Railway
- **CRM** (`crm.html`) — ממשק ניהול לקוחות, מוגש מהבוט
- **נתונים** — נשמרים ב-`/data/customers.json` על Railway Volume
- **GitHub backup** — גיבוי אוטומטי יומי ב-4:00 בלילה

### URL-ים חשובים
- בוט: `https://juliet-bot-production.up.railway.app`
- CRM: `https://juliet-bot-production.up.railway.app/crm?pass=juliet2026`
- QR: `https://juliet-bot-production.up.railway.app/qr`
- סטטוס: `https://juliet-bot-production.up.railway.app/status`
- Reset session: `https://juliet-bot-production.up.railway.app/reset-session`

---

## ✅ פיצ'רים פעילים

### בוט וואטסאפ
- תפריט אוטומטי ללקוחות חדשות (עברית + רוסית)
- תזכורת יום לפני תור (10:00–20:00) עם כתובת + הוראות שטיפה
- ✅/❌ אישור/ביטול תור מהלקוחה
- Follow-up ב-19:00 אחרי הטיפול ("איך השיער?")
- ביקורת גוגל ב-20:00 אחרי תור
- תזכורת חידוש שורשים — 7 חודשים אחרי
- תזכורת חזרה ללקוחות שלא הגיעו 7 חודשים
- שידורים קבוצתיים לפי פילטר (שירות, ימים, VIP)
- ברכות יום הולדת אוטומטיות
- סנכרון עם lee calendar
- Claude AI — תשובות חכמות ללקוחות
- גיבוי אוטומטי ל-GitHub

### CRM
- טבלת לקוחות עם פילטרים (VIP, חדשה, hot/cold, תור קרוב)
- יומן חודשי עם תורים
- פאנל פרופיל לקוחה (4 טאבים: סיכום, ביקורים, הערות, שיחה)
- כרטיס לקוחה דיגיטלי (🪪) — עמוד HTML יפה עם כל הפרטים
- הוספת/עריכת תורים
- תזכורות אישיות
- רשימת המתנה
- שליחת הודעה קבוצתית מה-CRM
- כפתור 🔔 שליחת תזכורות ישירות מיומן (לחיצה על יום המחרת)
- גיבוי ידני ל-GitHub (☁️)
- ייצוא CSV

### הודעת תזכורת ללקוחה
```
היי [שם]! 💎
תזכורת לתור מחר ב-[שעה] — [שירות] אצל Juliet Beauty Boutique 💇‍♀️

📍 כתובת:
הציונות 61 דירה 14, אשדוד
📞 ברגע שמגיעים לשער — יש להתקשר ואפתח אותו
🔑 קוד כניסה מקדימה: 0965
🚪 דלת לבנה: 1998⭐ (כוכבית בסוף)

🚿 הכנה לטיפול — חשוב!
לפני הגעתך תחפפי את השיער בשמפו ללא מסכה
השיער חייב להגיע נקי ויבש לטיפול 💆‍♀️

אם יש שינוי בתור שלחי הודעה 🙏

✅ לאישור תור | ❌ לביטול
מחכה לך! 💫
```

---

## 🔧 משימה נוכחית

**שליחת תזכורות דרך CRM / HTTP** — תוקנה בבאג: `SALON_ADDRESS` היה נקרא לפני הגדרתו.
פתרון: `httpSendReminders()` היא פונקציה שמוגדרת אחרי כל ה-consts, ו-endpoint קורא לה ב-`setTimeout(..., 100)`.

---

## 📋 משימות פתוחות

- [ ] וידוא שתזכורות נשלחות בפועל (בדיקה לאחר deploy)
- [ ] GITHUB_TOKEN — לוודא שמוגדר ב-Railway Variables לגיבוי אוטומטי
- [ ] Railway Volume — לוודא שמחובר ל-`/data` כדי שסשן וואטסאפ לא יאבד בין restarts
- [ ] בדיקת כפתור 🪪 כרטיס לקוחה
- [ ] ייצוא כרטיס לקוחה כ-PDF

---

## 💡 החלטות חשובות

| נושא | החלטה |
|------|--------|
| שפה | עברית בכל הממשקים |
| סיסמת CRM | `juliet2026` |
| מספר ג'ולייט | `972586210365` |
| שמירת נתונים | `/data/customers.json` על Railway Volume |
| Timezone | Israel (UTC+3) — `Date.UTC(yr, mo-1, dy, hr-3, mn, 0)` |
| תזכורות | חלון 10:00–20:00 ישראל |
| lee_ keys | מסוננות בתצוגה אם קיים לקוח אמיתי באותו שם |
| modals CSS | `position:fixed` עם `cssText` כדי לעקוף iOS Safari |
| overflow | `html{overflow-x:hidden}` — לא `body` (iOS fix) |

---

## 📁 קבצים מרכזיים

| קובץ | תפקיד |
|------|--------|
| `juliet-menu-bot.js` | הבוט — server, WhatsApp, API endpoints |
| `crm.html` | ממשק CRM — מוגש ב-`/crm` |
| `/data/customers.json` | נתוני לקוחות (Railway Volume) |
| `/data/reminders.json` | תזכורות אישיות |
| `/data/waitlist.json` | רשימת המתנה |
| `/data/.wwebjs_auth/` | סשן WhatsApp (Railway Volume) |

---

## 🕐 עדכון אחרון
**15.4.2026** — תיקון httpSendReminders(), קבצי זיכרון נוצרו
