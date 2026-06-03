import pg from 'pg'
const { Pool } = pg

const pool = new Pool({ connectionString: 'postgresql://postgres.clzafsoiidrlxrrlxzyv:kdm37197019*@aws-1-us-east-1.pooler.supabase.com:5432/postgres' })
const TARGET = 798629.96
const fmt = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })

const { rows } = await pool.query(`
  SELECT cfop, COUNT(*) as qtd, ROUND(SUM(valor::numeric),2) as total
  FROM notas_fiscais
  WHERE periodo = '2026-05' AND (cancelada IS NULL OR cancelada = false)
  GROUP BY cfop ORDER BY SUM(valor::numeric) DESC
`)

const grupos = {}
let grand = 0
console.log('\nMAIO/2026 por CFOP:')
for (const row of rows) {
  const v = Number(row.total)
  grupos[row.cfop || 'null'] = v
  grand += v
  console.log('  ' + String(row.cfop || 'null').padEnd(8) + String(row.qtd).padStart(5) + ' NFs   R$ ' + fmt(v))
}
console.log('  TOTAL                  R$ ' + fmt(grand))

const keys = Object.keys(grupos)
console.log('\nBuscando combinações próximas a R$', fmt(TARGET), '(tolerância R$2)\n')
let found = false
for (const a of keys) {
  if (Math.abs(grupos[a] - TARGET) < 2) { console.log('✅ só ' + a + ' = R$' + fmt(grupos[a])); found = true }
  for (const b of keys) {
    if (a >= b) continue
    const s = grupos[a] + grupos[b]
    if (Math.abs(s - TARGET) < 2) { console.log('✅ ' + a + '+' + b + ' = R$' + fmt(s)); found = true }
    for (const c of keys) {
      if (b >= c) continue
      const s3 = grupos[a] + grupos[b] + grupos[c]
      if (Math.abs(s3 - TARGET) < 2) { console.log('✅ ' + a + '+' + b + '+' + c + ' = R$' + fmt(s3)); found = true }
    }
  }
}
if (!found) console.log('Nenhuma combinação exata encontrada nas NFs de Maio.')

// Verificar também em todos os períodos
const { rows: all } = await pool.query(`
  SELECT periodo, cfop, ROUND(SUM(valor::numeric),2) as total
  FROM notas_fiscais WHERE cancelada IS NOT TRUE
  GROUP BY periodo, cfop ORDER BY periodo, SUM(valor::numeric) DESC
`)
console.log('\nTodos os períodos:')
let lastP = ''
for (const r of all) {
  if (r.periodo !== lastP) { console.log('\n  ' + r.periodo); lastP = r.periodo }
  console.log('    ' + String(r.cfop||'null').padEnd(8) + 'R$ ' + fmt(Number(r.total)))
}

await pool.end()
