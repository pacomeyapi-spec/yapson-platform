const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username et password requis' });

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, allowedNetworks: user.allowedNetworks },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

module.exports = router;
