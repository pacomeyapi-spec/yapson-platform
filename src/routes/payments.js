const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const connectpro = require('../services/connectpro');

const prisma = new PrismaClient();

// Récupérer les réseaux autorisés pour l'utilisateur connecté
router.get('/networks', authenticate, async (req, res) => {
  const allNetworks = await connectpro.getNetworks();

  if (req.user.role === 'ADMIN') return res.json(allNetworks);

  let allowed = null;
  try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}

  if (!allowed || allowed.length === 0) return res.json([]);
  res.json(allNetworks.filter(n => allowed.includes(n.code)));
});

// Créer une transaction — sauvegardée en BDD avec l'ID de l'utilisateur
router.post('/transactions', authenticate, async (req, res) => {
  const { type, network, phone, amount } = req.body;
  if (!type || !network || !phone || !amount)
    return res.status(400).json({ error: 'type, network, phone et amount requis' });

  // Vérification autorisation réseau pour les agents
  if (req.user.role !== 'ADMIN') {
    let allowed = null;
    try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}
    if (!allowed || !allowed.includes(network))
      return res.status(403).json({ error: `Réseau "${network}" non autorisé pour votre compte` });
  }

  // Créer la transaction sur ConnectPro
  const tx = await connectpro.createTransaction({ type, networkCode: network, phone, amount });

  // Récupérer infos réseau
  const networks = await connectpro.getNetworks();
  const net = networks.find(n => n.code === network) || { nom: network };

  // Sauvegarder en base locale
  const saved = await prisma.transaction.create({
    data: {
      connectproUid: tx.uid,
      type: tx.type,
      amount: parseFloat(amount),
      formattedAmount: tx.formatted_amount || null,
      phone: phone,
      networkCode: network,
      networkName: net.nom,
      status: tx.status || 'pending',
      userId: req.user.id,
    },
    include: { user: { select: { username: true } } }
  });

  res.status(201).json({ ...tx, _localId: saved.id, _createdBy: saved.user.username });
});

// Lister les transactions
// - ADMIN : toutes les transactions + filtre optionnel par utilisateur
// - AGENT : uniquement ses propres transactions
router.get('/transactions', authenticate, async (req, res) => {
  const { page = 1, pageSize = 20, type, status, network, phone } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(pageSize);
  const take = parseInt(pageSize);

  // Construire le filtre
  const where = {};

  // Restriction par utilisateur pour les agents
  if (req.user.role !== 'ADMIN') {
    where.userId = req.user.id;
  }

  if (type) where.type = type;
  if (status) where.status = status;
  if (network) where.networkCode = network;
  if (phone) where.phone = { contains: phone };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } }
    }),
    prisma.transaction.count({ where })
  ]);

  // Formater pour correspondre au format ConnectPro attendu par le frontend
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
    _localId: t.id,
  }));

  res.json({ count: total, results });
});

// Détails d'une transaction (via ConnectPro)
router.get('/transactions/:uid', authenticate, async (req, res) => {
  // Vérifier que l'agent a accès à cette transaction
  if (req.user.role !== 'ADMIN') {
    const local = await prisma.transaction.findFirst({
      where: { connectproUid: req.params.uid, userId: req.user.id }
    });
    if (!local) return res.status(403).json({ error: 'Accès refusé' });
  }
  const transaction = await connectpro.getTransaction(req.params.uid);
  res.json(transaction);
});

// Compte ConnectPro (admin uniquement)
router.get('/account', authenticate, async (req, res) => {
  const account = await connectpro.getAccount();
  res.json(account);
});

module.exports = router;
