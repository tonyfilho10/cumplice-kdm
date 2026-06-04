import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL!,
      // DIRECT_URL usado para migrations (ddl não funciona bem com pgbouncer)
      // Se não estiver definido, usa DATABASE_URL como fallback
      migrate: {
        url: (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
      },
    },
  },
})
