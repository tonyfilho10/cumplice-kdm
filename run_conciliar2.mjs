import { conciliarPeriodo } from './src/lib/conciliar.ts'

const r = await conciliarPeriodo('cd04b7c6-7ec3-4f59-849c-6730fc8ac9b9', '2026-05')
console.log(JSON.stringify(r, null, 2))
process.exit(0)
