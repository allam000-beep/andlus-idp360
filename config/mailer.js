// ═══════════════════════════════════════════════════════════════
// وحدة إرسال البريد — ج-3 (نسيت كلمة السر)
// في التطوير: تطبع الرابط في السجل. في الإنتاج: تُرسل عبر SMTP إن ضُبطت المتغيّرات.
//
// للتفعيل الفعلي على السيرفر، اضبط متغيّرات البيئة التالية:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// وثبّت الحزمة: npm install nodemailer
// ═══════════════════════════════════════════════════════════════

let transporter = null;
let nodemailer = null;

function initTransporter() {
  if (transporter !== null) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER) {
    transporter = false; // غير مضبوط — سنطبع في السجل بدلاً من الإرسال
    return transporter;
  }
  try {
    nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } catch (e) {
    console.warn('⚠️  nodemailer غير مثبّت — سيُطبع رابط إعادة التعيين في السجل. ثبّت: npm install nodemailer');
    transporter = false;
  }
  return transporter;
}

// يرسل بريد إعادة تعيين كلمة المرور. يُرجع true إن أُرسل فعلياً، false إن طُبع فقط.
async function sendPasswordReset(toEmail, resetLink, userName) {
  const t = initTransporter();
  const subject = 'إعادة تعيين كلمة المرور — منصة الأندلس للتطوّر المهني';
  const text = `مرحباً ${userName || ''}،\n\nلإعادة تعيين كلمة المرور، افتح الرابط التالي (صالح لمدة ساعة):\n${resetLink}\n\nإن لم تطلب ذلك، تجاهل هذه الرسالة.\n\nشركة الأندلس التعليمية`;
  const html = `<div dir="rtl" style="font-family:sans-serif;color:#15385C">
    <h2>إعادة تعيين كلمة المرور</h2>
    <p>مرحباً ${userName || ''}،</p>
    <p>لإعادة تعيين كلمة مرور حسابك في منصة الأندلس للتطوّر المهني، اضغط الزرّ التالي (صالح لمدة ساعة):</p>
    <p><a href="${resetLink}" style="background:#15385C;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">إعادة تعيين كلمة المرور</a></p>
    <p style="color:#5B7A9E;font-size:13px">إن لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    <p style="color:#5B7A9E;font-size:13px">شركة الأندلس التعليمية</p>
  </div>`;

  if (!t) {
    // لا SMTP مضبوط — نطبع الرابط (للتطوير/الاختبار)
    console.log('\n📧 [بريد إعادة التعيين — لم يُرسل فعلياً، اضبط SMTP للإرسال]');
    console.log(`   إلى: ${toEmail}`);
    console.log(`   الرابط: ${resetLink}\n`);
    return false;
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject, text, html,
  });
  return true;
}

module.exports = { sendPasswordReset };
