import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.digitalMenu.findMany({
  where: { publishedAt: { not: null }, deletedAt: null },
  select: { slug: true, title: true },
});
console.log(JSON.stringify(rows));
await p.$disconnect();
