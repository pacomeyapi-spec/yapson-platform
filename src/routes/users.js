const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

// Lister les utilisateurs (admin)
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, isActive: true, allowedNetworks: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json(users);
});

// Créer un utilisateur (admin)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { username, password, role = 'AGENT', allowedNetworks } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username et password requis' });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username, password: hash, role,
      allowedNetworks: allowedNetworks ? JSON.stringify(allowedNetworks) : null
    },
    select: { id: true, username: true, role: true, isActive: true, allowedNetworks: true }
  });
  res.status(201).json(user);
});

// Modifier un utilisateur (admin) — réseaux, statut, mot de passe
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { username, password, role, isActive, allowedNetworks } = req.body;
  const data = {};
  if (username) data.username = username;
  if (password) data.password = await bcrypt.hash(password, 10);
  if (role) data.role = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (allowedNetworks !== undefined)
    data.allowedNetworks = allowedNetworks ? JSON.stringify(allowedNetworks) : null;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, username: true, role: true, isActive: true, allowedNetworks: true }
  });
  res.json(user);
});

// Supprimer un utilisateur
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
