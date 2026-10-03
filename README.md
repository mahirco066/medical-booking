# منصة موعدي - المرحلة الثانية

هذه النسخة تضيف:
- Node.js + Express
- تشغيل المشروع على Render
- API health check على `/api/health`
- نقطة اتصال جاهزة لـ Supabase
- حماية مفاتيح Supabase من الرفع إلى GitHub عبر `.gitignore`

## التشغيل المحلي

```bash
npm install
npm start
```

ثم افتح:
http://localhost:3000

اختبار الخادم:
http://localhost:3000/api/health

## متغيرات البيئة

في Render سنضيف:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

لا تضع مفتاح Service Role داخل ملفات الواجهة أو GitHub.
