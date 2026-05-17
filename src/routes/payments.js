const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const connectpro = require('../services/connectpro');

const prisma = new PrismaClient();

// ── Réseaux ──────────────────────────────────────────────────────────────────
router.get('/networks', authenticate, async (req, res) => {
  try {
    const all = await connectpro.getNetworks();
    if (req.user.role === 'ADMIN') return res.json(all);
    let allowed = null;
    try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}
    if (!allowed || allowed.length === 0) return res.json([]);
    res.json(all.filter(n => allowed.includes(n.code)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Créer une transaction ────────────────────────────────────────────────────
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

  // Log pour debug
  console.log('ConnectPro response keys:', Object.keys(tx).join(','));
  console.log('ConnectPro uid:', tx.uid, '| status:', tx.status);

  // Extraire l'identifiant unique — ConnectPro retourne "uid"
  const txUid = tx.uid || tx.id || tx.reference || null;

  if (!txUid) {
    console.error('CRITICAL: ConnectPro response has no uid/id/reference:', JSON.stringify(tx).substring(0, 500));
    // On retourne quand même la réponse ConnectPro
    return res.status(201).json(tx);
  }

  // Récupérer le nom du réseau
  const nets = await connectpro.getNetworks();
  const net = nets.find(n => n.code === network) || { nom: network };

  // Sauvegarder en BDD
  try {
    await prisma.transaction.upsert({
      where: { connectproUid: txUid },
      update: { status: tx.status || 'pending' },
      create: {
        connectproUid: txUid,
        type: tx.type || type,
        amount: parseFloat(amount),
        formattedAmount: tx.formatted_amount || null,
        phone: tx.recipient_phone || phone,
        networkCode: network,
        networkName: net.nom,
        status: tx.status || 'pending',
        userId: req.user.id,
      }
    });
    console.log('DB saved OK:', txUid);
  } catch(dbErr) {
    console.error('DB save error:', dbErr.message);
  }

  res.status(201).json(tx);
});

// ── Historique (plateforme uniquement) ───────────────────────────────────────
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

    res.json({
      count: total,
      results: transactions.map(t => ({
        uid: t.connectproUid,
        type: t.type,
        amount: t.amount.toString(),
        formatted_amount: t.formattedAmount || `${t.amount.toLocaleString('fr')} FCFA`,
        recipient_phone: t.phone,
        network: { nom: t.networkName, code: t.networkCode },
        status: t.status,
        created_at: t.createdAt,
        _createdBy: t.user?.username,
      }))
    });
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
    res.json(await connectpro.getTransaction(req.params.uid));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Compte ConnectPro ────────────────────────────────────────────────────────
router.get('/account', authenticate, async (req, res) => {
  try { res.json(await connectpro.getAccount()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : vider toutes les transactions ────────────────────────────────────
router.delete('/clear-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await prisma.transaction.deleteMany({});
    res.json({ message: `${result.count} transactions supprimées`, count: result.count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
