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

type SaidaBanco  = { id: string; data: Date; valor: number; descricao: string }
type ContaAberta = { id: string; fornecedor_nome: string; vencimento: Date | null; valor_parcela: number }
type DebugInfo   = { saidas: number; contas: number; amostra_saidas: string[]; amostra_contas: string[]; falhas: string[] }

export async function cruzarFornecedores(
  clienteId: string,
  periodos: string[]
): Promise<{ baixas: number; debug: DebugInfo }> {

  const saidas = await prisma.bancoLancamento.findMany({
    where: {
      cliente_id: clienteId,
      tipo: 'saida',
      periodo: { in: periodos },
      status: { in: ['pendente', 'sem_nf'] },
    },
    select: { id: true, data: true, valor: true, descricao: true },
  }) as unknown as SaidaBanco[]

  const contasAbertas = await prisma.$queryRawUnsafe<ContaAberta[]>(
    `SELECT id::text, fornecedor_nome, vencimento, valor_parcela
     FROM contas_pagar
     WHERE cliente_id = $1
       AND situacao = 'Aberta'
       AND banco_lancamento_id IS NULL`,
    clienteId
  )

  const debug: DebugInfo = {
    saidas: saidas.length,
    contas: contasAbertas.length,
    amostra_saidas: saidas.slice(0, 3).map(s => `R$${Number(s.valor).toFixed(2)} | ${s.descricao?.substring(0,40)}`),
    amostra_contas: contasAbertas.slice(0, 3).map(c => `${c.fornecedor_nome} R$${Number(c.valor_parcela).toFixed(2)}`),
    falhas: [],
  }

  if (saidas.length === 0 || contasAbertas.length === 0) {
    return { baixas: 0, debug }
  }

  // Cria cópia mutável para marcar contas já vinculadas nesta rodada
  const contasLivres = [...contasAbertas]
  let baixasFeitas = 0

  for (const saida of saidas) {
    const valorSaida = Number(saida.valor)

    for (let i = 0; i < contasLivres.length; i++) {
      const conta = contasLivres[i]
      const saldoConta = Number(conta.valor_parcela)

      // 1. Valor ±2%
      const diffValor = saldoConta > 0 ? Math.abs(valorSaida - saldoConta) / saldoConta : 1
      if (diffValor > 0.02) continue

      // 2. Nome na descrição
      if (!nomeSimilar(conta.fornecedor_nome, saida.descricao)) {
        if (diffValor < 0.001) {
          debug.falhas.push(`valor ok mas nome falhou: "${conta.fornecedor_nome}" vs "${saida.descricao?.substring(0,40)}"`)
        }
        continue
      }

      // 3. Data ±180 dias (cobre atrasos e pagamentos antecipados dentro dos 6 meses do dataset)
      if (conta.vencimento) {
        const dataLanc = new Date(saida.data)
        const dataVenc = new Date(conta.vencimento)
        const diffDias = Math.abs((dataLanc.getTime() - dataVenc.getTime()) / 86400000)
        if (diffDias > 180) {
          debug.falhas.push(`valor+nome ok mas data falhou: ${conta.fornecedor_nome} diffDias=${diffDias}`)
          continue
        }
      }

      // Match confirmado
      try {
        await prisma.$transaction([
          prisma.bancoLancamento.update({
            where: { id: saida.id },
            data: { status: 'ok', categoria: 'Fornecedor' },
          }),
          prisma.$executeRawUnsafe(
            `UPDATE contas_pagar SET situacao='Pago', valor_pago=$1, banco_lancamento_id=$2 WHERE id=$3::uuid`,
            saldoConta, saida.id, conta.id
          ),
        ])
        baixasFeitas++
        contasLivres.splice(i, 1)
      } catch (err) {
        debug.falhas.push(`erro ao salvar: ${err instanceof Error ? err.message : String(err)}`)
      }
      break
    }
  }

  return { baixas: baixasFeitas, debug }
}
