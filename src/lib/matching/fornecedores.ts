/**
 * Cruzamento automático de saídas bancárias com contas a pagar de fornecedores.
 * Chamado após importação de extrato para dar baixa quando há match forte.
 *
 * Usa Prisma.$queryRawUnsafe para as tabelas fornecedores_cadastro e contas_pagar,
 * que existem no banco mas não no schema Prisma (criadas via SQL manual).
 */

import { prisma } from '@/lib/prisma'

function normalizar(s: string) {
  return (s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
}

function nomeSimilar(nomeFornecedor: string, descricaoBanco: string): boolean {
  const nf = normalizar(nomeFornecedor)
  const db = normalizar(descricaoBanco)
  const palavras = nf.split(' ').filter(p => p.length > 3)
  return palavras.some(p => db.includes(p))
}

type SaidaBanco = { id: string; data: Date; valor: number; descricao: string }
type ContaAberta = { id: string; fornecedor_nome: string; vencimento: Date | null; valor_parcela: number }

/**
 * Para cada saída bancária nova (pendente/sem_nf) nos períodos informados,
 * tenta encontrar uma conta a pagar em aberto com match por:
 *   - valor idêntico (diferença ≤ 0,1%)
 *   - nome do fornecedor na descrição do lançamento bancário
 *   - vencimento dentro de ±30 dias da data do lançamento
 *
 * Quando encontra match, marca:
 *   - banco_lancamento: status='ok', categoria='Fornecedor'
 *   - contas_pagar: situacao='Pago', valor_pago, banco_lancamento_id
 *
 * Retorna o número de baixas automáticas realizadas.
 */
export async function cruzarFornecedores(clienteId: string, periodos: string[]): Promise<number> {
  const saidas = await prisma.bancoLancamento.findMany({
    where: {
      cliente_id: clienteId,
      tipo: 'saida',
      periodo: { in: periodos },
      status: { in: ['pendente', 'sem_nf'] },
      nota_fiscal_id: null,
    },
    select: { id: true, data: true, valor: true, descricao: true },
  }) as unknown as SaidaBanco[]

  if (saidas.length === 0) return 0

  // Busca contas a pagar em aberto via raw SQL (tabela fora do schema Prisma)
  const contasAbertas = await prisma.$queryRawUnsafe<ContaAberta[]>(
    `SELECT id, fornecedor_nome, vencimento, valor_parcela
     FROM contas_pagar
     WHERE cliente_id = $1
       AND situacao = 'Aberta'
       AND banco_lancamento_id IS NULL`,
    clienteId
  )

  if (contasAbertas.length === 0) return 0

  let baixasFeitas = 0

  for (const saida of saidas) {
    for (const conta of contasAbertas) {
      const saldoConta = Number(conta.valor_parcela)
      const valorSaida = Number(saida.valor)

      // Valor deve ser idêntico (tolerância 0,1%)
      const diffValor = saldoConta > 0 ? Math.abs(valorSaida - saldoConta) / saldoConta : 1
      if (diffValor > 0.001) continue

      // Nome do fornecedor deve aparecer na descrição bancária
      if (!nomeSimilar(conta.fornecedor_nome, saida.descricao)) continue

      // Vencimento dentro de ±30 dias
      if (conta.vencimento) {
        const dataLanc = new Date(saida.data)
        const dataVenc = new Date(conta.vencimento)
        const diffDias = Math.abs((dataLanc.getTime() - dataVenc.getTime()) / 86400000)
        if (diffDias > 30) continue
      }

      // Match — dar baixa
      await prisma.$transaction([
        prisma.bancoLancamento.update({
          where: { id: saida.id },
          data: { status: 'ok', categoria: 'Fornecedor' },
        }),
        prisma.$executeRawUnsafe(
          `UPDATE contas_pagar
           SET situacao = 'Pago', valor_pago = $1, banco_lancamento_id = $2
           WHERE id = $3`,
          saldoConta, saida.id, conta.id
        ),
      ])

      baixasFeitas++
      // Remove da lista de abertas para não vincular o mesmo fornecedor duas vezes
      contasAbertas.splice(contasAbertas.indexOf(conta), 1)
      break
    }
  }

  return baixasFeitas
}
