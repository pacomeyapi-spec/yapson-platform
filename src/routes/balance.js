const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

// ── Mon solde + code de recharge ──────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { balance: true, rechargeCode: true }
  });
  res.json(user);
});

// ── Historique des mouvements ─────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  const where = req.user.role === 'ADMIN'
    ? {}
    : { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] };

  const txs = await prisma.balanceTx.findMany({
    where,
    include: {
      sender:   { select: { username: true } },
      receiver: { select: { username: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(txs);
});

// ── Admin : recharger un agent par rechargeCode ───────────────────────────
router.post('/recharge', authenticate, requireAdmin, async (req, res) => {
  const { rechargeCode, amount, note } = req.body;
  if (!rechargeCode || !amount || amount <= 0)
    return res.status(400).json({ error: 'rechargeCode et amount requis' });

  const target = await prisma.user.findUnique({ where: { rechargeCode } });
  if (!target) return res.status(404).json({ error: 'Code de recharge invalide' });

  const [updatedUser, tx] = await prisma.$transaction([
    prisma.user.update({
      where: { id: target.id },
      data: { balance: { increment: amount } }
    }),
    prisma.balanceTx.create({
      data: {
        type: 'RECHARGE',
        amount,
        note: note || `Recharge admin`,
        status: 'approved',
        senderId: req.user.id,
        receiverId: target.id
      }
    })
  ]);

  res.json({ success: true, newBalance: updatedUser.balance, tx });
});

// ── Demande de transfert UV entre agents ──────────────────────────────────
router.post('/transfer-request', authenticate, async (req, res) => {
  const { rechargeCode, amount, note } = req.body;
  if (!rechargeCode || !amount || amount <= 0)
    return res.status(400).json({ error: 'rechargeCode et amount requis' });

  const sender = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (sender.role !== 'ADMIN' && sender.balance < amount)
    return res.status(400).json({ error: `Solde insuffisant (${sender.balance} UV)` });

  const receiver = await prisma.user.findUnique({ where: { rechargeCode } });
  if (!receiver) return res.status(404).json({ error: 'Code de recharge invalide' });
  if (receiver.id === sender.id) return res.status(400).json({ error: 'Impossible de se transférer à soi-même' });

  const tx = await prisma.balanceTx.create({
    data: {
      type: 'TRANSFER',
      amount,
      note: note || '',
      status: 'pending',
      senderId: sender.id,
      receiverId: receiver.id
    }
  });

  res.json({ success: true, tx, receiver: receiver.username });
});

// ── Valider/Rejeter une demande de transfert ──────────────────────────────
router.post('/transfer-approve/:txId', authenticate, async (req, res) => {
  const { action } = req.body; // 'approve' | 'reject'
  const tx = await prisma.balanceTx.findUnique({
    where: { id: req.params.txId },
    include: { sender: true, receiver: true }
  });

  if (!tx) return res.status(404).json({ error: 'Transaction introuvable' });
  if (tx.status !== 'pending') return res.status(400).json({ error: 'Déjà traitée' });

  // Seul l'admin ou le destinataire peut approuver
  const isAdmin = req.user.role === 'ADMIN';
  const isReceiver = tx.receiverId === req.user.id;
  if (!isAdmin && !isReceiver)
    return res.status(403).json({ error: 'Non autorisé' });

  if (action === 'reject') {
    await prisma.balanceTx.update({ where: { id: tx.id }, data: { status: 'rejected' } });
    return res.json({ success: true, status: 'rejected' });
  }

  // Vérifier solde de l'expéditeur (sauf admin)
  const sender = await prisma.user.findUnique({ where: { id: tx.senderId } });
  if (sender.role !== 'ADMIN' && sender.balance < tx.amount)
    return res.status(400).json({ error: `Solde expéditeur insuffisant (${sender.balance} UV)` });

  // Effectuer le transfert
  const ops = [
    prisma.user.update({
      where: { id: tx.receiverId },
      data: { balance: { increment: tx.amount } }
    }),
    prisma.balanceTx.update({ where: { id: tx.id }, data: { status: 'approved' } })
  ];
  if (sender.role !== 'ADMIN') {
    ops.push(prisma.user.update({
      where: { id: tx.senderId },
      data: { balance: { decrement: tx.amount } }
    }));
  }

  await prisma.$transaction(ops);
  const updated = await prisma.user.findUnique({ where: { id: tx.receiverId }, select: { balance: true, username: true } });
  res.json({ success: true, status: 'approved', newBalance: updated.balance });
});

// ── Demandes en attente (pour admin et agents destinataires) ──────────────
router.get('/pending', authenticate, async (req, res) => {
  const where = req.user.role === 'ADMIN'
    ? { status: 'pending' }
    : { receiverId: req.user.id, status: 'pending' };

  const txs = await prisma.balanceTx.findMany({
    where,
    include: {
      sender:   { select: { username: true } },
      receiver: { select: { username: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(txs);
});

// ── Admin : liste des soldes de tous les agents ───────────────────────────
router.get('/agents', authenticate, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, balance: true, rechargeCode: true },
    orderBy: { username: 'asc' }
  });
  res.json(users);
});

module.exports = router;

// ── Demande de recharge (agent → admin) ──────────────────────────────────
router.post('/recharge-request', authenticate, async (req, res) => {
  const { amount, note } = req.body;
  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'Montant invalide' });

  // Trouve l'admin
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) return res.status(404).json({ error: 'Administrateur introuvable' });

  const tx = await prisma.balanceTx.create({
    data: {
      type: 'TRANSFER',
      amount,
      note: note || 'Demande de recharge UV',
      status: 'pending',
      senderId: null,          // l'admin est la source (il n'est pas débité)
      receiverId: req.user.id, // l'agent qui demande
    }
  });
  res.json({ success: true, tx });
});
