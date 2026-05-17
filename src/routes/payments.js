const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const connectpro = require('../services/connectpro');

const prisma = new PrismaClient();

// ── Réseaux autorisés ────────────────────────────────────────────────────────
router.get('/networks', authenticate, async (req, res) => {
  try {
    const allNetworks = await connectpro.getNetworks();
    if (req.user.role === 'ADMIN') return res.json(allNetworks);
    let allowed = null;
    try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}
    if (!allowed || allowed.length === 0) return res.json([]);
    res.json(allNetworks.filter(n => allowed.includes(n.code)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Créer une transaction ────────────────────────────────────────────────────
// Chaque transaction est sauvegardée localement avec l'userId de celui qui la crée.
// L'historique de la plateforme est totalement indépendant de ConnectPro.
router.post('/transactions', authenticate, async (req, res) => {
  const { type, network, phone, amount } = req.body;
  if (!type || !network || !phone || !amount)
    return res.status(400).json({ error: 'type, network, phone et amount requis' });

  if (req.user.role !== 'ADMIN') {
    let allowed = null;
    try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}
    if (!allowed || !allowed.includes(network))
      return res.status(403).json({ error: `Réseau "${network}" non autorisé` });
  }

  // Envoyer à ConnectPro
  const tx = await connectpro.createTransaction({ type, networkCode: network, phone, amount });

  // Récupérer le nom du réseau
  const networks = await connectpro.getNetworks();
  const net = networks.find(n => n.code === network) || { nom: network };

  // Sauvegarder en BDD — lié à l'utilisateur qui a initié la transaction
  try {
    await prisma.transaction.upsert({
      where: { connectproUid: tx.uid },
      update: { status: tx.status || 'pending' },
      create: {
        connectproUid: tx.uid,
        type: tx.type || type,
        amount: parseFloat(amount),
        formattedAmount: tx.formatted_amount || null,
        phone: phone,
        networkCode: network,
        networkName: net.nom,
        status: tx.status || 'pending',
        userId: req.user.id,
      }
    });
  } catch(dbErr) {
    console.error('DB save error:', dbErr.message);
  }

  res.status(201).json(tx);
});

// ── Historique ───────────────────────────────────────────────────────────────
// AGENT → seulement ses propres transactions
// ADMIN → toutes les transactions de tous les agents de la plateforme
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 20, type, status, network, phone } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const where = {};
    if (req.user.role !== 'ADMIN') where.userId = req.user.id;
    if (type) where.type = type;
    if (status) where.status = status;
    if (network) where.networkCode = network;
    if (phone) where.phone = { contains: phone };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where, skip, take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } }
      }),
      prisma.transaction.count({ where })
    ]);

    const results = transactions.map(t => ({
      uid: t.connectproUid,
      type: t.type,
      amount: t.amount.toString(),
      formatted_amount: t.formattedAmount || `${t.amount.toLocaleString('fr')} FCFA`,
      recipient_phone: t.phone,
      network: { nom: t.networkName, code: t.networkCode },
      status: t.status,
      created_at: t.createdAt,
      _createdBy: t.user?.username,
    }));

    res.json({ count: total, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Détail d'une transaction ─────────────────────────────────────────────────
router.get('/transactions/:uid', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      const local = await prisma.transaction.findFirst({
        where: { connectproUid: req.params.uid, userId: req.user.id }
      });
      if (!local) return res.status(403).json({ error: 'Accès refusé' });
    }
    const transaction = await connectpro.getTransaction(req.params.uid);
    res.json(transaction);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Compte ConnectPro ────────────────────────────────────────────────────────
router.get('/account', authenticate, async (req, res) => {
  try {
    const account = await connectpro.getAccount();
    res.json(account);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : vider toutes les transactions importées par erreur ───────────────
router.delete('/clear-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await prisma.transaction.deleteMany({});
    res.json({ message: `${result.count} transactions supprimées`, count: result.count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
