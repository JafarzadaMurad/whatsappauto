import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

console.log('DATABASE_URL starts with:', process.env.DATABASE_URL?.substring(0, 20));

const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Attempting to connect...');
        await prisma.$connect();
        console.log('✅ Connected!');
        const count = await prisma.user.count();
        console.log('User count:', count);
    } catch (e) {
        console.error('❌ Error during Prisma test:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
