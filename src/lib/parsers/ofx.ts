// Parser de extrato bancário OFX
// Suporta:
//   - OFX 1.x SGML (padrão dos bancos brasileiros — SEM tags de fechamento)
//   - OFX 2.x XML  (tags com fechamento)
//   - Codificação WINDOWS-1252 / ISO-8859-1 / UTF-8

export type OFXLancamento = {
  tipo: 'entrada' | 'saida'
  data: string       // YYYY-MM-DD
  valor: number
  descricao: string
  id_transacao?: string
  categoria?: string
}

export type OFXResultado = {
  lancamentos: OFXLancamento[]
  total_parsed: number
  banco?: string
  conta?: string
  data_inicio?: string
  data_fim?: string
  erro?: string
}

// ─── Categorização automática ─────────────────────────────────────────────────
const CATEGORIAS: [string, string[]][] = [
  ['Venda de Mercadoria',  ['PIX RECEB', 'CARTAO POS', 'VENDA', 'TEF CRED', 'CIELO', 'STONE', 'REDE ', 'GETNET', 'PAGSEGURO', 'MERCADO PAGO']],
  ['Pagamento Fornecedor', ['PGTO FORNEC', 'PAG FORNEC', 'BOLETO PAGO', 'TED PAGO', 'PIX ENVIADO']],
  ['Folha de Pagamento',   ['FOLHA', 'SALARIO', 'FOPAG', 'PGTO FUNC', 'PAG FUNC']],
  ['Pró-Labore',           ['PRO-LABORE', 'PROLABORE', 'PRO LABORE', 'RETIRADA SOCIO', 'RETIRADA']],
  ['Aluguel',              ['ALUGUEL', 'LOCACAO', 'ALUG ']],
  ['Energia Elétrica',     ['CELESC', 'CEMIG', 'LIGHT ', 'CPFL', 'COELBA', 'ENERGISA', 'CEEE', 'ENEL ', 'ENERGIA ELET']],
  ['Telefone/Internet',    ['VIVO', 'CLARO', 'TIM ', 'NET COMBO', 'EMBRATEL', 'OI FIXO', 'TELEFONE', 'INTERNET']],
  ['Imposto/Tributo',      ['DAS-', 'DAS ', 'DARF', ' GPS ', 'FGTS', 'SIMPLES NAC', 'RECEITA FED', 'TRIBUTO', 'INSS']],
  ['Contabilidade',        ['CONTABILIDADE', 'HONORARIOS', 'ESCRIT CONT']],
  ['Empréstimo/Aporte',    ['EMPRESTIMO', 'APORTE', 'TED APORTE', 'CAPITAL SOCIAL']],
]

function inferirCategoria(desc: string, tipo: 'entrada' | 'saida'): string {
  const up = desc.toUpperCase()
  for (const [cat, palavras] of CATEGORIAS) {
    if (palavras.some(p => up.includes(p))) return cat
  }
  return tipo === 'entrada' ? 'Venda de Mercadoria' : 'Despesa Operacional'
}

// ─── Parse de data OFX ────────────────────────────────────────────────────────
// Formatos: 20260501 | 20260501120000 | 20260501120000.000 | 20260501120000[-03:00]
function parseDataOFX(raw: string): string {
  const clean = raw.replace(/\[.*\]/, '').replace(/\..+/, '').trim()
  if (clean.length < 8) return ''
  return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`
}

// ─── Normaliza valor ──────────────────────────────────────────────────────────
function parseValor(raw: string): number {
  // Alguns bancos usam vírgula como separador decimal
  const normalizado = raw.trim().replace(/\s/g, '').replace(',', '.')
  return parseFloat(normalizado)
}

// ─── Extrai o conteúdo de uma tag OFX (SGML ou XML) ──────────────────────────
// OFX 1.x SGML: <TAG>valor  (sem fechamento)
// OFX 2.x XML:  <TAG>valor</TAG>
function getTag(bloco: string, tag: string): string {
  // Tenta com fechamento (XML)
  const xmlMatch = bloco.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'))
  if (xmlMatch) return xmlMatch[1].trim()
  // Sem fechamento (SGML) — vai até nova linha ou próxima tag
  const sgmlMatch = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))
  return sgmlMatch ? sgmlMatch[1].trim() : ''
}

// ─── Parser principal ─────────────────────────────────────────────────────────
export function parseOFX(content: string): OFXResultado {
  try {
    // Decodifica WINDOWS-1252 se necessário (bancos brasileiros antigos)
    let texto = content

    // Remove o cabeçalho de texto plano do OFX 1.x (linhas antes de <OFX> ou <STMTTRN>)
    const inicioOFX = texto.search(/<OFX>|<ofx>/i)
    if (inicioOFX > 0) texto = texto.substring(inicioOFX)

    // Banco e conta
    const banco = getTag(texto, 'BANKID') || getTag(texto, 'ORG')
    const conta = getTag(texto, 'ACCTID')
    const dtStart = parseDataOFX(getTag(texto, 'DTSTART'))
    const dtEnd   = parseDataOFX(getTag(texto, 'DTEND'))

    // ── Estratégia 1: split em <STMTTRN> (funciona para SGML e XML) ──────────
    // Divide o conteúdo pelo início de cada transação
    const partes = texto.split(/<STMTTRN>/i)
    partes.shift() // primeira parte é cabeçalho, descarta

    const lancamentos: OFXLancamento[] = []

    for (const bloco of partes) {
      const trntype   = getTag(bloco, 'TRNTYPE').toUpperCase()
      const dtposted  = getTag(bloco, 'DTPOSTED')
      const trnamtRaw = getTag(bloco, 'TRNAMT')
      const memo      = getTag(bloco, 'MEMO') || getTag(bloco, 'NAME') || ''
      const fitid     = getTag(bloco, 'FITID')

      if (!dtposted || !trnamtRaw) continue

      const trnamt = parseValor(trnamtRaw)
      if (isNaN(trnamt)) continue

      const data = parseDataOFX(dtposted)
      if (!data || data === '--') continue

      const valor = Math.abs(trnamt)
      if (valor === 0) continue

      // Determina entrada/saída pelo valor ou pelo TRNTYPE
      const tiposCredito = ['CREDIT', 'DEP', 'INT', 'DIVIDEND', 'DIRECTDEP']
      const tipo: 'entrada' | 'saida' =
        trnamt > 0 || tiposCredito.includes(trntype)
          ? 'entrada'
          : 'saida'

      lancamentos.push({
        tipo,
        data,
        valor,
        descricao: memo || trntype || 'Lançamento',
        id_transacao: fitid || undefined,
        categoria: inferirCategoria(memo, tipo),
      })
    }

    const ordenados = lancamentos.sort((a, b) => a.data.localeCompare(b.data))

    return {
      lancamentos: ordenados,
      total_parsed: ordenados.length,
      banco: banco || undefined,
      conta: conta || undefined,
      data_inicio: dtStart || undefined,
      data_fim: dtEnd || undefined,
    }
  } catch (err) {
    return {
      lancamentos: [],
      total_parsed: 0,
      erro: err instanceof Error ? err.message : 'Erro ao processar OFX',
    }
  }
}

export async function parseOFXFile(file: File): Promise<OFXResultado> {
  // Tenta UTF-8 primeiro; se houver caracteres inválidos, tenta LATIN-1
  let content: string
  try {
    content = await file.text() // UTF-8
    // Checa se houve corrupção típica de WINDOWS-1252
    if (content.includes('�')) {
      const buffer = await file.arrayBuffer()
      content = new TextDecoder('windows-1252').decode(buffer)
    }
  } catch {
    const buffer = await file.arrayBuffer()
    content = new TextDecoder('windows-1252').decode(buffer)
  }
  return parseOFX(content)
}
