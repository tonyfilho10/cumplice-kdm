import { config } from 'dotenv'
config({ path: '.env' })
config({ path: '.env.local', override: true })
import { PrismaClient } from '../src/generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const tabelas = [
  'clientes', 'compras', 'notas_fiscais',
  'banco_lancamentos', 'despesas', 'divergencias', 'contas_bancarias',
]

async function main() {
  console.log('🔧 Garantindo DEFAULT gen_random_uuid() em todas as tabelas...\n')
  for (const t of tabelas) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${t}" ALTER COLUMN id SET DEFAULT gen_random_uuid()`
      )
      console.log(`✅ ${t}`)
    } catch (e: unknown) {
      console.log(`⚠️  ${t}: ${(e as Error).message}`)
    }
  }
  console.log('\n✅ Concluído — inserts via Supabase REST funcionarão.')
}

main().catch(e => { console.error(e.message); process.exit(1) }).finally(() => prisma.$disconnect())
