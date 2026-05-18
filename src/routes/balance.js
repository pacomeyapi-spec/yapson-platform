const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const prisma = new PrismaClient();

// ── Mon solde + code de recharge ──────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { balance: true, rechargeCode: true }
    });
    res.json(user || { balance: 0, rechargeCode: null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Historique des mouvements ─────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : recharger un agent par rechargeCode ───────────────────────────
router.post('/recharge', authenticate, requireAdmin, async (req, res) => {
  try {
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
          note: note || 'Recharge admin',
          status: 'approved',
          senderId: req.user.id,
          receiverId: target.id
        }
      })
    ]);
    res.json({ success: true, newBalance: updatedUser.balance, tx });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Demande de recharge UV (agent → admin) ────────────────────────────────
// L'agent crée une demande, l'admin la voit dans "pending" et l'approuve
router.post('/recharge-request', authenticate, async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (!amount || amount <= 0)
      return res.status(400).json({ error: 'Montant invalide' });

    const tx = await prisma.balanceTx.create({
      data: {
        type: 'RECHARGE',          // type RECHARGE → admin crédite
        amount,
        note: note || 'Demande de recharge UV',
        status: 'pending',
        senderId: null,            // pas d'expéditeur (l'admin crédite depuis illimité)
        receiverId: req.user.id,   // l'agent qui reçoit
      }
    });
    res.json({ success: true, tx });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Demande de transfert UV entre agents ──────────────────────────────────
router.post('/transfer-request', authenticate, async (req, res) => {
  try {
    const { rechargeCode, amount, note } = req.body;
    if (!rechargeCode || !amount || amount <= 0)
      return res.status(400).json({ error: 'rechargeCode et amount requis' });

    const sender = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (sender.role !== 'ADMIN' && sender.balance < amount)
      return res.status(400).json({ error: `Solde insuffisant (${sender.balance} FCFA)` });

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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Valider/Rejeter une demande ───────────────────────────────────────────
router.post('/transfer-approve/:txId', authenticate, async (req, res) => {
  try {
    const { action } = req.body; // 'approve' | 'reject'
    const tx = await prisma.balanceTx.findUnique({
      where: { id: req.params.txId },
      include: { sender: true, receiver: true }
    });

    if (!tx) return res.status(404).json({ error: 'Transaction introuvable' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Déjà traitée' });

    // Seul l'admin ou le destinataire peut approuver/rejeter
    const isAdmin = req.user.role === 'ADMIN';
    const isReceiver = tx.receiverId === req.user.id;
    if (!isAdmin && !isReceiver)
      return res.status(403).json({ error: 'Non autorisé' });

    if (action === 'reject') {
      await prisma.balanceTx.update({ where: { id: tx.id }, data: { status: 'rejected' } });
      return res.json({ success: true, status: 'rejected' });
    }

    // ── Approuver ────────────────────────────────────────────────────────
    // Cas 1 : senderId est null → c'est une demande de recharge admin
    //         L'admin crédite l'agent sans déduire rien
    // Cas 2 : senderId présent → transfert agent→agent ou admin→agent
    //         Vérifier solde de l'expéditeur si ce n'est pas l'admin

    const isRechargeRequest = !tx.senderId;

    if (!isRechargeRequest && tx.sender) {
      // Vérifier que l'expéditeur a assez
      if (tx.sender.role !== 'ADMIN' && tx.sender.balance < tx.amount) {
        return res.status(400).json({
          error: `Solde expéditeur insuffisant : ${tx.sender.balance} FCFA disponibles`
        });
      }
    }

    // Construire les opérations
    const ops = [
      // Créditer le destinataire
      prisma.user.update({
        where: { id: tx.receiverId },
        data: { balance: { increment: tx.amount } }
      }),
      // Marquer la tx comme approuvée
      prisma.balanceTx.update({ where: { id: tx.id }, data: { status: 'approved' } })
    ];

    // Débiter l'expéditeur si ce n'est pas une demande de recharge admin
    if (!isRechargeRequest && tx.sender && tx.sender.role !== 'ADMIN') {
      ops.push(prisma.user.update({
        where: { id: tx.senderId },
        data: { balance: { decrement: tx.amount } }
      }));
    }

    await prisma.$transaction(ops);
    const updated = await prisma.user.findUnique({
      where: { id: tx.receiverId },
      select: { balance: true, username: true }
    });
    res.json({ success: true, status: 'approved', newBalance: updated.balance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Demandes en attente ───────────────────────────────────────────────────
router.get('/pending', authenticate, async (req, res) => {
  try {
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
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : soldes de tous les agents ─────────────────────────────────────
router.get('/agents', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, balance: true, rechargeCode: true },
      orderBy: { username: 'asc' }
    });
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
