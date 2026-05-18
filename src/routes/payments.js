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

  // ── Vérification du solde UV AVANT toute transaction ─────────────────────
  if (req.user.role !== 'ADMIN') {
    const txType   = (type || '').toLowerCase();
    const isDepot  = txType === 'deposit'    || txType === 'depot';
    const isRetrait= txType === 'withdrawal' || txType === 'retrait';

    // Recharger le solde depuis la BDD (pas le token JWT qui peut être obsolète)
    const userFresh = await prisma.user.findUnique({ where: { id: req.user.id } });
    const solde     = userFresh ? userFresh.balance : 0;
    const montant   = parseFloat(amount);

    if (isDepot) {
      // Un dépôt coûte des UV — il faut avoir assez
      if (solde <= 0) {
        return res.status(402).json({
          error: 'Solde UV insuffisant',
          detail: 'Votre solde est à 0 UV. Faites une demande de recharge avant de pouvoir effectuer un dépôt.',
          solde,
          montant
        });
      }
      if (montant > solde) {
        return res.status(402).json({
          error: 'Solde UV insuffisant',
          detail: `Vous n'avez que ${solde.toLocaleString('fr')} UV disponibles pour ce dépôt de ${montant.toLocaleString('fr')} FCFA. Rechargez votre solde.`,
          solde,
          montant
        });
      }
    }

    // Vérification des réseaux autorisés
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


// ── Webhook ConnectPro : mise à jour automatique du statut ───────────────────
// ConnectPro appelle cette URL quand le statut d'une transaction change
// URL à configurer dans ConnectPro : https://yapson-platform-production.up.railway.app/api/payments/webhook
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    // ConnectPro peut envoyer uid ou transaction_uid ou id
    const uid = payload.uid || payload.transaction_uid || payload.id;
    const status = payload.status || payload.new_status;
    
    console.log('Webhook received:', JSON.stringify(payload).substring(0, 200));
    
    if (!uid) return res.status(400).json({ error: 'uid manquant dans le payload' });
    if (!status) return res.status(400).json({ error: 'status manquant dans le payload' });

    const updated = await prisma.transaction.updateMany({
      where: { connectproUid: uid },
      data: { status: status, updatedAt: new Date() }
    });

    console.log(`Webhook OK: ${uid} → ${status} (${updated.count} ligne mise à jour)`);
    res.json({ ok: true, updated: updated.count });
  } catch(e) {
    console.error('Webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// ── Webhook ConnectPro : mise à jour automatique du statut ───────────────────
// ConnectPro appelle cette URL quand le statut d'une transaction change
router.post('/webhook', async (req, res) => {
  try {
    const { uid, status } = req.body;
    if (!uid || !status) return res.status(400).json({ error: 'uid et status requis' });

    const updated = await prisma.transaction.updateMany({
      where: { connectproUid: uid },
      data: { status: status, updatedAt: new Date() }
    });

    console.log(`Webhook: ${uid} → ${status} (${updated.count} row updated)`);
    res.json({ ok: true, updated: updated.count });
  } catch(e) {
    console.error('Webhook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
