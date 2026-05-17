require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Servir le frontend
app.use(express.static(path.join(__dirname, '../../frontend')));

// Routes API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
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

  app.listen(PORT, () => console.log(`🚀 Port ${PORT}`));
}

start();
