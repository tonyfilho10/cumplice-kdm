/**
 * Seed: importa fornecedores e contas a pagar dos PDFs para o Supabase
 * Uso: node scripts/seed_fornecedores.mjs <CLIENTE_ID>
 *
 * Depende de: pdfplumber (Python) já ter gerado fornecedores_data.json
 * Ou rode antes: python scripts/extract_fornecedores_pdf.py
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const clienteId = process.argv[2]
if (!clienteId) {
  console.error('Uso: node scripts/seed_fornecedores.mjs <CLIENTE_ID>')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Dados extraídos dos PDFs
const dataPath = join('C:\\Users\\caruaru contabil\\Downloads', 'fornecedores_data.json')
const { fornecedores, contas } = JSON.parse(readFileSync(dataPath, 'utf-8'))

function parseBrDate(str) {
  if (!str) return null
  const [d, m, y] = str.split('/')
  return `${y}-${m}-${d}`
}

async function main() {
  console.log(`Cliente: ${clienteId}`)
  console.log(`Fornecedores: ${fornecedores.length} | Contas: ${contas.length}`)

  // ── Fornecedores ──────────────────────────────────────────────
  console.log('\nInserindo fornecedores...')
  const fornRows = fornecedores.map(f => ({
    cliente_id: clienteId,
    cnpj: f.cnpj,
    codigo_erp: f.codigo,
    nome: f.nome,
  }))

  const { error: eF } = await supabase
    .from('fornecedores_cadastro')
    .upsert(fornRows, { onConflict: 'cliente_id,cnpj' })

  if (eF) { console.error('Erro fornecedores:', eF.message); process.exit(1) }
  console.log(`✓ ${fornRows.length} fornecedores inseridos/atualizados`)

  // ── Contas a Pagar ─────────────────────────────────────────────
  console.log('\nInserindo contas a pagar...')

  // Deletar as existentes do cliente antes de recriar (re-importação limpa)
  await supabase.from('contas_pagar').delete().eq('cliente_id', clienteId)

  const contaRows = contas.map(c => ({
    cliente_id: clienteId,
    fornecedor_codigo: c.fornecedor_codigo,
    fornecedor_nome: c.fornecedor_nome,
    documento: c.documento,
    emissao: parseBrDate(c.emissao),
    entrada: parseBrDate(c.entrada),
    vencimento: parseBrDate(c.vencimento),
    valor_parcela: c.valor_parcela,
    valor_pago: c.valor_pago,
    situacao: c.situacao === 'Aberta' ? 'Aberta' : 'Pago',
  }))

  const { error: eC } = await supabase.from('contas_pagar').insert(contaRows)
  if (eC) { console.error('Erro contas:', eC.message); process.exit(1) }
  console.log(`✓ ${contaRows.length} contas inseridas`)

  const totalAberto = contaRows
    .filter(c => c.situacao === 'Aberta')
    .reduce((s, c) => s + c.valor_parcela, 0)
  console.log(`\nTotal em aberto: R$ ${totalAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
  console.log('\nSeed concluído com sucesso!')
}

main().catch(e => { console.error(e); process.exit(1) })
