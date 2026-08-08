const { db, initSchema, seedDefaults } = require('../db');
const { hashPassword } = require('../config/auth');
initSchema(); seedDefaults();
(async () => {
  const exists = db.prepare("SELECT 1 FROM users WHERE username='admin'").get();
  if (!exists) {
    const hash = await hashPassword('Admin@123');
    db.prepare("INSERT INTO users (id,username,password_hash,name,role) VALUES (?,?,?,?,?)")
      .run('__admin__','admin',hash,'مدير النظام','admin');
    console.log('✓ حساب المدير: admin / Admin@123');
  } else console.log('حساب المدير موجود');
})();
