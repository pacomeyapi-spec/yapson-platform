const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const connectpro = require('../services/connectpro');

// Récupérer les réseaux autorisés pour l'utilisateur connecté
router.get('/networks', authenticate, async (req, res) => {
  const allNetworks = await connectpro.getNetworks();

  // Admin voit tous les réseaux
  if (req.user.role === 'ADMIN') return res.json(allNetworks);

  // Agent voit seulement ses réseaux autorisés
  let allowed = null;
  try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}

  if (!allowed || allowed.length === 0) return res.json([]); // aucun réseau autorisé

  const filtered = allNetworks.filter(n => allowed.includes(n.code));
  res.json(filtered);
});

// Créer une transaction
router.post('/transactions', authenticate, async (req, res) => {
  const { type, network, phone, amount } = req.body;
  if (!type || !network || !phone || !amount)
    return res.status(400).json({ error: 'type, network, phone et amount requis' });

  // Vérifier que l'utilisateur a accès à ce réseau
  if (req.user.role !== 'ADMIN') {
    let allowed = null;
    try { allowed = req.user.allowedNetworks ? JSON.parse(req.user.allowedNetworks) : null; } catch {}
    if (!allowed || !allowed.includes(network))
      return res.status(403).json({ error: `Réseau "${network}" non autorisé pour votre compte` });
  }

  const transaction = await connectpro.createTransaction({ type, networkCode: network, phone, amount });
  res.status(201).json(transaction);
});

// Lister les transactions
router.get('/transactions', authenticate, async (req, res) => {
  const { page = 1, pageSize = 20, type, status, network, phone } = req.query;
  const data = await connectpro.getTransactions({ page, pageSize, type, status, network, phone });
  res.json(data);
});

// Détails d'une transaction
router.get('/transactions/:uid', authenticate, async (req, res) => {
  const transaction = await connectpro.getTransaction(req.params.uid);
  res.json(transaction);
});

// Compte ConnectPro (solde)
router.get('/account', authenticate, async (req, res) => {
  const account = await connectpro.getAccount();
  res.json(account);
});

module.exports = router;
