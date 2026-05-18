const { PrismaClient } = require('@prisma/client');
const connectpro = require('./connectpro');

const prisma = new PrismaClient();
const FINAL = ['success','failed','cancelled','refunded'];

async function updateBalance(tx) {
  // Retrait réussi → solde augmente / Dépôt réussi → solde diminue
  if (tx.status !== 'success') return;
  const user = await prisma.user.findUnique({ where: { id: tx.userId } });
  if (!user) return;

  let delta = 0;
  const type = (tx.type || '').toLowerCase();
  if (type === 'retrait' || type === 'withdrawal') delta = tx.amount;
  else if (type === 'depot' || type === 'deposit') delta = -tx.amount;

  if (delta === 0) return;

  const newBalance = Math.max(0, user.balance + delta);
  await prisma.$transaction([
    prisma.user.update({ where: { id: tx.userId }, data: { balance: newBalance } }),
    prisma.balanceTx.create({
      data: {
        type: delta > 0 ? 'CREDIT_RETRAIT' : 'DEBIT_DEPOT',
        amount: Math.abs(delta),
        note: `Auto: ${tx.type} ${tx.amount} FCFA - ${tx.phone}`,
        status: 'approved',
        senderId: delta < 0 ? tx.userId : null,
        receiverId: delta > 0 ? tx.userId : null
      }
    })
  ]);
  console.log(`💰 Balance ${user.username}: ${user.balance} → ${newBalance} (${delta > 0 ? '+' : ''}${delta})`);
}

async function pollOnce() {
  const pending = await prisma.transaction.findMany({
    where: { status: { notIn: FINAL } },
    select: { id: true, connectproUid: true, userId: true, type: true, amount: true, phone: true, status: true }
  });

  for (const tx of pending) {
    try {
      const remote = await connectpro.getTransaction(tx.connectproUid);
      const newStatus = remote.status || tx.status;
      if (newStatus !== tx.status) {
        const updated = await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: newStatus, updatedAt: new Date() }
        });
        console.log(`🔄 ${tx.connectproUid}: ${tx.status} → ${newStatus}`);
        // Mise à jour du solde si succès
        await updateBalance({ ...tx, status: newStatus });
      }
    } catch(e) {
      if (!e.message.includes('404')) console.error(`Poll error ${tx.connectproUid}:`, e.message);
    }
  }
}

function startPoller() {
  console.log('⏱ Status poller démarré (15s)');
  setInterval(pollOnce, 15000);
}

module.exports = { startPoller };
