const axios = require('axios');

const BASE = process.env.CONNECTPRO_BASE_URL;
const AUTH = `ApiKey ${process.env.CONNECTPRO_API_KEY}:${process.env.CONNECTPRO_API_SECRET}`;

const client = axios.create({
  baseURL: BASE,
  headers: { Authorization: AUTH, 'Content-Type': 'application/json' }
});

// Logos personnalisés pour certains réseaux (URL publique)
const CUSTOM_LOGOS = {
  '2e1':     'https://i.ibb.co/nNBZJvDg/image.png',
  '2e2':     'https://i.ibb.co/nNBZJvDg/image.png',
  'omtrans': 'https://i.ibb.co/nNBZJvDg/image.png',
  'n81x2':   'https://i.ibb.co/nNBZJvDg/image.png',
};

// Récupérer tous les réseaux disponibles
async function getNetworks() {
  const { data } = await client.get('/payments/networks/');
  const networks = data.results || [];
  // Injecter les logos personnalisés
  return networks.map(n => ({
    ...n,
    image: CUSTOM_LOGOS[n.code] || n.image || null
  }));
}

// Créer une transaction (dépôt ou retrait)
async function createTransaction({ type, networkCode, phone, amount }) {
  const networks = await getNetworks();
  const network = networks.find(n => n.code === networkCode);
  if (!network) throw new Error(`Réseau "${networkCode}" introuvable`);

  const payload = {
    type,
    network: network.uid,
    recipient_phone: phone,
    amount: parseFloat(amount)
  };

  const { data } = await client.post('/payments/user/transactions/', payload);
  return data;
}

async function getTransactions({ page = 1, pageSize = 20, type, status, network, phone } = {}) {
  const params = new URLSearchParams({ page, page_size: pageSize });
  if (type) params.append('type', type);
  if (status) params.append('status', status);
  if (network) params.append('network__code', network);
  if (phone) params.append('recipient_phone__contains', phone);
  const { data } = await client.get(`/payments/user/transactions/?${params}`);
  return data;
}

async function getTransaction(uid) {
  const { data } = await client.get(`/payments/user/transactions/${uid}/`);
  return data;
}

async function getAccount() {
  const { data } = await client.get('/payments/user/account/');
  return data;
}

module.exports = { getNetworks, createTransaction, getTransactions, getTransaction, getAccount };
