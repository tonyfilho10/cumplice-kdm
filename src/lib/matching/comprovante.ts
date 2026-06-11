// Vincula dados extraídos de um comprovante (valor/data) a um lançamento bancário

export type LancamentoParaMatch = { id: string; valor: number; data: string }

const TOLERANCIA_VALOR = 0.01
const TOLERANCIA_DIAS = 5

function diffDias(a: string, b: string): number {
  const ta = new Date(a + 'T00:00:00').getTime()
  const tb = new Date(b + 'T00:00:00').getTime()
  return Math.abs(ta - tb) / (1000 * 60 * 60 * 24)
}

export function matchComprovanteLancamento(
  dados: { valor: number | null; data: string | null },
  lancamentos: LancamentoParaMatch[]
): string | null {
  if (dados.valor == null) return null

  const porValor = lancamentos.filter(l => Math.abs(l.valor - dados.valor!) <= TOLERANCIA_VALOR)
  if (porValor.length === 0) return null

  if (dados.data) {
    const porValorEData = porValor.filter(l => diffDias(l.data.substring(0, 10), dados.data!) <= TOLERANCIA_DIAS)
    if (porValorEData.length === 1) return porValorEData[0].id
    if (porValorEData.length > 1) return null // ambíguo, deixa para o usuário
  }

  // Fallback: valor único entre os lançamentos
  if (porValor.length === 1) return porValor[0].id

  return null
}
