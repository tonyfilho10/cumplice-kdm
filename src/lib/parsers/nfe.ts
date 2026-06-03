import { XMLParser } from 'fast-xml-parser'

export type NFeParsed = {
  chave_acesso: string
  numero: string
  serie: string
  data_emissao: string
  cfop: string
  valor_total: number
  cnpj_emitente: string
  razao_emitente: string
  cnpj_destinatario?: string
  razao_destinatario?: string
  natureza_operacao: string
  tipo: 'entrada' | 'saida'
  formato: 'nfe' | 'nfse'   // distingue produto x serviço
  itens: NFeItem[]
  erro?: string
}

export type NFeItem = {
  descricao: string
  cfop: string
  valor: number
  quantidade: number
  unidade: string
  ncm?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
})

function getText(obj: unknown): string {
  if (typeof obj === 'string') return obj
  if (typeof obj === 'number') return String(obj)
  if (obj && typeof obj === 'object' && '#text' in (obj as Record<string, unknown>)) {
    return String((obj as Record<string, unknown>)['#text'])
  }
  return ''
}

function getNum(obj: unknown): number {
  return parseFloat(getText(obj)) || 0
}

// Busca infNFe em qualquer nível da estrutura parseada
function encontrarInfoNFe(obj: unknown, profundidade = 0): unknown {
  if (profundidade > 6 || !obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (o.infNFe) return o.infNFe
  // Procura em cada chave filha
  for (const val of Object.values(o)) {
    const found = encontrarInfoNFe(val, profundidade + 1)
    if (found) return found
  }
  return null
}

// ─── NF-e (produtos) ─────────────────────────────────────────────────────────
function parseNFe(result: Record<string, unknown>): NFeParsed {
  // Tenta os caminhos mais comuns primeiro (rápido)
  const root = result.nfeProc || result.NFeProc || result
  const nfe = (root as Record<string, unknown>).NFe || (root as Record<string, unknown>).nfe
    || result.NFe || result.nfe
  const infNFe = (nfe as Record<string, unknown>)?.infNFe
    // Fallback: busca recursiva em toda a árvore (cobre variações de estrutura)
    || encontrarInfoNFe(result)

  if (!infNFe) {
    const chaves = Object.keys(result).join(', ')
    throw new Error(`Estrutura NF-e inválida — infNFe não encontrado. Chaves no root: [${chaves}]`)
  }

  const inf = infNFe as Record<string, unknown>
  const chave = getText(inf['@_Id'] || '').replace('NFe', '')
  const ide = (inf.ide || {}) as Record<string, unknown>
  const emit = (inf.emit || {}) as Record<string, unknown>
  const dest = (inf.dest || {}) as Record<string, unknown>
  const total = ((inf.total || {}) as Record<string, unknown>).ICMSTot || {}

  const det = inf.det
  const detArray = Array.isArray(det) ? det : det ? [det] : []
  const itens: NFeItem[] = detArray.map((d: unknown) => {
    const prod = ((d as Record<string, unknown>).prod || {}) as Record<string, unknown>
    return {
      descricao: getText(prod.xProd),
      cfop: getText(prod.CFOP),
      valor: getNum(prod.vProd),
      quantidade: getNum(prod.qCom),
      unidade: getText(prod.uCom),
      ncm: getText(prod.NCM),
    }
  })

  return {
    chave_acesso: chave,
    numero: getText(ide.nNF),
    serie: getText(ide.serie),
    data_emissao: getText(ide.dhEmi || ide.dEmi).substring(0, 10),
    // Prefere o CFOP de venda quando há itens mistos (ex: venda + remessa)
    cfop: itens.find(it => ['5101','5102','5103','5104','5105','5106','6101','6102','6103','6104','6105','6106','6107','6108','5401','5403','5405','6401','6403','5124','6124'].includes(it.cfop))?.cfop || itens[0]?.cfop || '',
    // vNFTot inclui IBS+CBS (reforma tributária 2026) — preferir quando disponível
    valor_total: getNum(
      (inf.total as Record<string, unknown>)?.vNFTot ||
      (total as Record<string, unknown>).vNF ||
      (total as Record<string, unknown>).vProd
    ),
    cnpj_emitente: getText(emit.CNPJ).replace(/\D/g, ''),
    razao_emitente: getText(emit.xNome || emit.xFant),
    cnpj_destinatario: getText(dest.CNPJ).replace(/\D/g, '') || undefined,
    razao_destinatario: getText(dest.xNome) || undefined,
    natureza_operacao: getText(ide.natOp),
    tipo: getText(ide.tpNF) === '0' ? 'entrada' : 'saida',
    formato: 'nfe',
    itens,
  }
}

// ─── NFS-e (serviços) — padrão nacional SPED/ABRASF ─────────────────────────
function parseNFSe(result: Record<string, unknown>): NFeParsed {
  // Suporta raiz NFSe ou CompNfse
  const root = result.NFSe || result.CompNfse || result
  const infNFSe = (root as Record<string, unknown>).infNFSe
    || ((root as Record<string, unknown>).NFSe as Record<string, unknown>)?.infNFSe

  if (!infNFSe) throw new Error('Estrutura NFS-e inválida — infNFSe não encontrado')

  const inf = infNFSe as Record<string, unknown>

  // Emitente
  const emit = (inf.emit || {}) as Record<string, unknown>

  // Tomador (dentro de DPS > infDPS > toma)
  const dps = inf.DPS as Record<string, unknown> | undefined
  const infDPS = dps?.infDPS as Record<string, unknown> | undefined
  const toma = infDPS?.toma as Record<string, unknown> | undefined

  // Serviço
  const serv = infDPS?.serv as Record<string, unknown> | undefined
  const cServ = (serv?.cServ || {}) as Record<string, unknown>
  const descServico = getText(cServ.xDescServ) || 'Serviço'
  const cTribNac = getText(cServ.cTribNac) || ''

  // Valores — tenta na raiz e dentro de DPS
  const valoresRaiz = (inf.valores || {}) as Record<string, unknown>
  const valoresDPS = (infDPS?.valores || {}) as Record<string, unknown>
  const vServPrest = (valoresDPS.vServPrest || {}) as Record<string, unknown>

  const valor = getNum(valoresRaiz.vLiq || valoresRaiz.vServ || vServPrest.vServ || 0)

  // Data — dhProc é data de processamento; dhEmi dentro de infDPS é data de emissão
  const dhEmi = getText(infDPS?.dhEmi || inf.dhProc || '')
  const dataEmissao = dhEmi.substring(0, 10)

  // Número
  const numero = getText(inf.nNFSe || inf.nDFSe || '')

  // Chave — usa o atributo Id do infNFSe
  const chave = getText(inf['@_Id'] || `NFS${numero}`)

  const cfop = '5933'

  return {
    chave_acesso: chave,
    numero,
    serie: getText(infDPS?.serie || ''),
    data_emissao: dataEmissao,
    cfop,
    valor_total: valor,
    cnpj_emitente: getText(emit.CNPJ).replace(/\D/g, ''),
    razao_emitente: getText(emit.xNome || emit.xFant),
    cnpj_destinatario: getText(toma?.CNPJ || '').replace(/\D/g, '') || undefined,
    razao_destinatario: getText(toma?.xNome || '') || undefined,
    natureza_operacao: descServico.substring(0, 80),
    tipo: 'saida', // NFS-e emitida = saída de serviço
    formato: 'nfse',
    itens: [{
      descricao: descServico.substring(0, 120),
      cfop,
      valor,
      quantidade: 1,
      unidade: 'UN',
    }],
  }
}

export type NFeEvento = {
  tipo: 'cancelamento' | 'carta_correcao' | 'outro'
  chave_nfe: string        // chave da NF afetada
  numero_protocolo?: string
  data_evento?: string
  justificativa?: string
  descricao: string
}

// Tenta parsear um XML de evento (procEventoNFe / procEventoNFCe)
export function parseEventoNFe(xmlContent: string): NFeEvento | null {
  try {
    const result = parser.parse(xmlContent) as Record<string, unknown>
    const root = (result.procEventoNFe || result.procEventoNFCe) as Record<string, unknown> | undefined
    if (!root) return null

    const evento = root.evento as Record<string, unknown> | undefined
    const retEvento = root.retEvento as Record<string, unknown> | undefined
    const infEvento = (evento?.infEvento || {}) as Record<string, unknown>
    const infRetEvento = (retEvento as Record<string, unknown>)?.infEvento as Record<string, unknown> | undefined

    const chave = getText(infEvento.chNFe)
    const tpEvento = getText(infEvento.tpEvento)
    const dhEvento = getText(infEvento.dhEvento || '').substring(0, 10)
    const nProt = getText(infRetEvento?.nProt || '')

    // detEvento contém a justificativa (cancelamento) ou a correção
    const detEvento = (infEvento.detEvento || {}) as Record<string, unknown>
    const xJust = getText(detEvento.xJust || detEvento.xCorrecao || '')

    // tpEvento: 110111 = Cancelamento NF-e, 110110 = Cancelamento NFC-e, 110112 = CCe
    const tipo: NFeEvento['tipo'] =
      tpEvento === '110111' || tpEvento === '110110' ? 'cancelamento'
      : tpEvento === '110112' ? 'carta_correcao'
      : 'outro'

    const descricao =
      tipo === 'cancelamento' ? `Cancelamento — Protocolo ${nProt || '?'}` :
      tipo === 'carta_correcao' ? `Carta de Correção — Protocolo ${nProt || '?'}` :
      `Evento ${tpEvento}`

    return { tipo, chave_nfe: chave, numero_protocolo: nProt, data_evento: dhEvento, justificativa: xJust, descricao }
  } catch {
    return null
  }
}

// XMLs que não são NF emitida e não são eventos — ignorar silenciosamente
const RAIZES_IGNORAR = new Set(['retInutNFe','inutNFe','retConsStatServ','retConsCad','retEnvLote','consStatServ'])

// ─── Detector automático ──────────────────────────────────────────────────────
export async function parseNFeXML(xmlContent: string): Promise<NFeParsed> {
  try {
    const result = parser.parse(xmlContent) as Record<string, unknown>

    // Ignora XMLs de consulta/inutilização sem reportar erro
    for (const key of RAIZES_IGNORAR) {
      if (result[key] !== undefined) {
        return {
          chave_acesso: '', numero: '', serie: '', data_emissao: '',
          cfop: '', valor_total: 0, cnpj_emitente: '', razao_emitente: '',
          natureza_operacao: '', tipo: 'saida', formato: 'nfe', itens: [],
          erro: 'Arquivo ignorado: XML de consulta/inutilização',
        }
      }
    }

    // Eventos (cancelamento, CCe) — sinaliza para o importador tratar separadamente
    if (result.procEventoNFe !== undefined || result.procEventoNFCe !== undefined) {
      return {
        chave_acesso: '', numero: '', serie: '', data_emissao: '',
        cfop: '', valor_total: 0, cnpj_emitente: '', razao_emitente: '',
        natureza_operacao: '', tipo: 'saida', formato: 'nfe', itens: [],
        erro: '__evento__',  // flag especial — o importador vai tratar
      }
    }

    // Detecta pelo namespace ou elemento raiz
    const isNFSe =
      xmlContent.includes('nfse.gov.br') ||
      xmlContent.includes('<NFSe') ||
      xmlContent.includes('<CompNfse') ||
      xmlContent.includes('infNFSe')

    return isNFSe ? parseNFSe(result) : parseNFe(result)
  } catch (err) {
    return {
      chave_acesso: '', numero: '', serie: '', data_emissao: '',
      cfop: '', valor_total: 0, cnpj_emitente: '', razao_emitente: '',
      natureza_operacao: '', tipo: 'saida', formato: 'nfe', itens: [],
      erro: err instanceof Error ? err.message : 'Erro desconhecido ao parsear XML',
    }
  }
}

// ─── Processa múltiplos arquivos ──────────────────────────────────────────────
export async function parseMultiplosXML(
  files: File[]
): Promise<{ sucesso: NFeParsed[]; erros: { arquivo: string; erro: string }[] }> {
  const sucesso: NFeParsed[] = []
  const erros: { arquivo: string; erro: string }[] = []

  for (const file of files) {
    const content = await file.text()
    const result = await parseNFeXML(content)
    if (result.erro) {
      erros.push({ arquivo: file.name, erro: result.erro })
    } else {
      sucesso.push(result)
    }
  }

  return { sucesso, erros }
}
