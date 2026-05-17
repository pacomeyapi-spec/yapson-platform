const { PrismaClient } = require('@prisma/client');
const connectpro = require('./connectpro');

const prisma = new PrismaClient();

// Interroge ConnectPro toutes les 15 secondes
// pour mettre à jour les transactions encore en "pending"
async function pollPendingTransactions() {
  try {
    const pending = await prisma.transaction.findMany({
      where: { status: 'pending' },
      select: { id: true, connectproUid: true }
    });

    if (pending.length === 0) return;

    console.log(`Polling: ${pending.length} transaction(s) pending...`);

    for (const tx of pending) {
      try {
        const remote = await connectpro.getTransaction(tx.connectproUid);
        const newStatus = remote.status;

        if (newStatus && newStatus !== 'pending') {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: newStatus, updatedAt: new Date() }
          });
          console.log(`Status updated: ${tx.connectproUid} → ${newStatus}`);
        }
      } catch(e) {
        // Ignorer les erreurs individuelles (tx introuvable, etc.)
      }
    }
  } catch(e) {
    console.error('Polling error:', e.message);
  }
}

function startPoller() {
  console.log('Status poller started (every 15s)');
  setInterval(pollPendingTransactions, 15000);
  // Premier run immédiat
  pollPendingTransactions();
}

module.exports = { startPoller };
