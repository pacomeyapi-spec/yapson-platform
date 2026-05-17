const { PrismaClient } = require('@prisma/client');
const connectpro = require('./connectpro');

const prisma = new PrismaClient();

// Statuts finaux — on ne poll plus ces transactions
const FINAL_STATUSES = ['success', 'failed', 'cancelled', 'refunded'];

async function pollPendingTransactions() {
  try {
    // Récupérer toutes les transactions NON finales
    const active = await prisma.transaction.findMany({
      where: {
        status: { notIn: FINAL_STATUSES }
      },
      select: { id: true, connectproUid: true, status: true }
    });

    if (active.length === 0) return;

    console.log(`Polling: ${active.length} transaction(s) non-finales...`);

    for (const tx of active) {
      try {
        const remote = await connectpro.getTransaction(tx.connectproUid);
        // getTransaction retourne directement l'objet (pas wrappé dans data)
        const newStatus = remote.status;

        if (newStatus && newStatus !== tx.status) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: newStatus, updatedAt: new Date() }
          });
          console.log(`✅ Status mis à jour: ${tx.connectproUid} [${tx.status}] → [${newStatus}]`);
        }
      } catch(e) {
        console.error(`Poll error pour ${tx.connectproUid}: ${e.message}`);
      }
    }
  } catch(e) {
    console.error('Polling error global:', e.message);
  }
}

function startPoller() {
  console.log('Status poller démarré (toutes les 15s)');
  // Premier run après 5s pour laisser le serveur démarrer
  setTimeout(() => {
    pollPendingTransactions();
    setInterval(pollPendingTransactions, 15000);
  }, 5000);
}

module.exports = { startPoller };
