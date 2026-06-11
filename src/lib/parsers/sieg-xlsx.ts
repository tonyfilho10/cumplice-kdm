import * as XLSX from 'xlsx'

export type SiegLinha = {
  numero: string
  valor: number
  data_emissao: string // YYYY-MM-DD
  cnpj_emitente: string
  nome_emitente: string
  cnpj_destinatario: string
  nome_destinatario: string
  chave_acesso: string
  cancelada: boolean
  formato: 'nfe' | 'nfce'
}

// Remove tudo que não é dígito — usado para comparar CNPJs em formatos diferentes
export function normalizarCNPJ(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '')
}

function normalizarTexto(s: unknown): string {
  return String(s ?? '').trim()
}

// Converte "DD/MM/YYYY" → "YYYY-MM-DD"
function converterData(s: unknown): string {
  const texto = normalizarTexto(s)
  const m = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return ''
  const [, dia, mes, ano] = m
  return `${ano}-${mes}-${dia}`
}

// Encontra o índice da coluna cujo cabeçalho contém (case-insensitive) o trecho buscado
function indiceColuna(header: unknown[], ...trechos: string[]): number {
  return header.findIndex(h => {
    const texto = normalizarTexto(h).toLowerCase()
    return trechos.some(t => texto.includes(t.toLowerCase()))
  })
}

// Lê um relatório "Relatório Xml Cofre SIEG" (.xlsx) e extrai as linhas de NF-e/NFC-e
export async function parseSiegXLSX(file: File): Promise<{ linhas: SiegLinha[]; erro?: string }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const linhas2D = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]

  const headerIdx = linhas2D.findIndex(row => {
    const primeira = normalizarTexto(row?.[0])
    return primeira === 'Num NFe' || primeira === 'Num NFCe'
  })

  if (headerIdx === -1) {
    return { linhas: [], erro: 'Formato de planilha não reconhecido (esperado relatório SIEG Cofre)' }
  }

  const header = linhas2D[headerIdx]
  const formato: SiegLinha['formato'] = normalizarTexto(header[0]) === 'Num NFCe' ? 'nfce' : 'nfe'

  const idx = {
    numero: 0,
    valor: indiceColuna(header, 'valor'),
    data: indiceColuna(header, 'data emissão', 'data emissao'),
    cnpjEmit: indiceColuna(header, 'cnpj emit'),
    nomeEmit: indiceColuna(header, 'razão soc. emit', 'razao soc. emit'),
    cnpjDest: indiceColuna(header, 'cnpj dest'),
    nomeDest: indiceColuna(header, 'razão soc. dest', 'razao soc. dest'),
    chave: indiceColuna(header, 'chave da'),
    status: indiceColuna(header, 'status'),
  }

  const linhas: SiegLinha[] = []
  for (let i = headerIdx + 1; i < linhas2D.length; i++) {
    const row = linhas2D[i]
    if (!row || row[idx.numero] == null) continue

    linhas.push({
      numero: normalizarTexto(row[idx.numero]),
      valor: Number(row[idx.valor]) || 0,
      data_emissao: converterData(row[idx.data]),
      cnpj_emitente: normalizarTexto(row[idx.cnpjEmit]),
      nome_emitente: normalizarTexto(row[idx.nomeEmit]),
      cnpj_destinatario: normalizarTexto(row[idx.cnpjDest]),
      nome_destinatario: normalizarTexto(row[idx.nomeDest]),
      chave_acesso: normalizarTexto(row[idx.chave]),
      cancelada: normalizarTexto(row[idx.status]).toLowerCase().startsWith('cancelamento'),
      formato,
    })
  }

  return { linhas }
}
