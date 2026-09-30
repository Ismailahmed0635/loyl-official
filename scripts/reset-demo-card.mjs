// Reset the Phase-3 walkthrough customer's card so the UI flow can run again.
// Usage: node scripts/reset-demo-card.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PHONE = '01770306471';
const MERCHANT = process.argv[2] || 'cmue7g8lw000zyze0yen251rk';

const card = await prisma.customerStamp.findUnique({
  where: { merchantId_customerPhone: { merchantId: MERCHANT, customerPhone: PHONE } },
});

if (!card) {
  console.log(`No card found for ${PHONE} @ ${MERCHANT}`);
} else {
  await prisma.customerStamp.update({
    where: { id: card.id },
    data: { stampsCollected: 0, totalRedeemed: 0, lastScannedAt: null, lastReviewAt: null },
  });
  console.log(
    `Reset card ${card.id}: stamps ${card.stampsCollected}->0, redeemed ${card.totalRedeemed}->0, cooldowns cleared`
  );
}

await prisma.$disconnect();
