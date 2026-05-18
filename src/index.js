require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const { startPoller } = require('./services/statusPoller');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Servir le frontend — no-cache pour index.html (forcer rechargement du code JS)
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Routes API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/balance', require('./routes/balance'));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

const PORT = process.env.PORT || 8080;

async function start() {
  try {
    const adminExists = await prisma.user.findUnique({ where: { username: 'admin' } });
    // Générer rechargeCode pour les users qui n'en ont pas encore
    const { randomBytes } = require('crypto');
    const usersWithoutCode = await prisma.user.findMany({
      where: { rechargeCode: null }
    });
    for (const u of usersWithoutCode) {
      await prisma.user.update({
        where: { id: u.id },
        data: { rechargeCode: randomBytes(6).toString('hex').toUpperCase() }
      });
      console.log('✅ rechargeCode généré pour:', u.username);
    }

    if (!adminExists) {
      await prisma.user.create({
        data: {
          username: 'admin',
          password: await bcrypt.hash('Yapson@2026!', 10),
          role: 'ADMIN'
        }
      });
      console.log('✅ Admin créé: admin / Yapson@2026!');
    }
  } catch(e) { console.error('Init error:', e.message); }

  app.listen(PORT, () => {
    console.log(`🚀 Port ${PORT}`);
    startPoller();
  });
}

start();
