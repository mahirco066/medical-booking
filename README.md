# موعدي — المرحلة الأولى من المنصة الحقيقية

هذه المرحلة تحول الواجهة إلى أساس Backend حقيقي مع Supabase.

## الملفات الجديدة
- `server.js` — API حقيقي.
- `package.json` — Express + Supabase.
- `supabase-schema.sql` — الجداول والصلاحيات.
- `.env.example` — متغيرات Render.
- `public/` — التصميم النهائي المعتمد.

## التشغيل على Render
Build Command:
`npm install`

Start Command:
`npm start`

Environment:
`SUPABASE_URL`
`SUPABASE_SERVICE_ROLE_KEY`

## أول خطوة
افتح Supabase → SQL Editor وشغّل ملف `supabase-schema.sql` كاملاً.

## ما تم تأسيسه
- المرضى.
- الأطباء.
- السكرتارية والإدارة كأدوار.
- التخصصات.
- العيادات.
- مواعيد الأطباء المتاحة.
- الحجوزات.
- الدفع في العيادة كخيار افتراضي.
- الإعلانات المدفوعة للصيدليات ومعامل التحاليل ومراكز الأشعة.
