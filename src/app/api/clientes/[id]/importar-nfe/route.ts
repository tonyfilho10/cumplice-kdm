import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseNFeXML, parseEventoNFe } from '@/lib/parsers/nfe'

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clienteId } = await params
    const supabase = await createClient()

    // Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
    }

    // Parse body
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({ erro: 'Corpo da requisição inválido' }, { status: 400 })
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ erro: 'Body inválido ou vazio' }, { status: 400 })
    }

    const { files, periodo } = rawBody as { files: { nome: string; conteudo: string }[]; periodo: string }

    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })
    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ erro: 'Nenhum arquivo recebido' }, { status: 400 })
    }

    // Verifica período fechado
    const { data: periodoFechado } = await supabase
      .from('periodos_fechados')
      .select('id')
      .eq('cliente_id', clienteId)
      .eq('periodo', periodo)
      .maybeSingle()

    if (periodoFechado) {
      return NextResponse.json(
        { erro: `O período ${periodo} está fechado.` },
        { status: 423 }
      )
    }

    const importados: string[] = []
    const erros: { arquivo: string; erro: string; detalhe?: string }[] = []
    const duplicados: { arquivo: string; numero: string; motivo: string; detalhe: string }[] = []
    const cancelamentos: string[] = []

    // Processa em lotes de 5
    const LOTE = 5
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE)

      await Promise.all(lote.map(async (file) => {
        try {
          const nfe = await parseNFeXML(file.conteudo)

          // Arquivo ignorado (consulta, inutilização)
          if (nfe.erro?.startsWith('Arquivo ignorado:')) return

          // Evento (cancelamento, CCe)
          if (nfe.erro === '__evento__') {
            const evento = parseEventoNFe(file.conteudo)
            if (!evento) {
              erros.push({ arquivo: file.nome, erro: 'Evento NF-e não reconhecido' })
              return
            }
            if (evento.tipo === 'cancelamento' && evento.chave_nfe) {
              const { data: nfExistente } = await supabase
                .from('notas_fiscais')
                .select('id, numero')
                .eq('chave_acesso', evento.chave_nfe)
                .eq('cliente_id', clienteId)
                .maybeSingle()

              if (nfExistente) {
                await supabase.from('notas_fiscais').update({ cancelada: true }).eq('id', nfExistente.id)
                cancelamentos.push(`NF ${nfExistente.numero} cancelada — ${evento.descricao}`)
              } else {
                cancelamentos.push(`Cancelamento para chave ${evento.chave_nfe.substring(0, 10)}... (NF não encontrada)`)
              }
            } else if (evento.tipo === 'carta_correcao') {
              cancelamentos.push(`Carta de Correção para ${evento.chave_nfe?.substring(0, 10)}... — ${evento.descricao}`)
            } else {
              cancelamentos.push(`Evento ${evento.descricao} recebido para ${file.nome}`)
            }
            return
          }

          // Erro de parse
          if (nfe.erro) {
            erros.push({ arquivo: file.nome, erro: nfe.erro })
            return
          }

          const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo

          const dadosNF = {
            cliente_id: clienteId,
            periodo: periodoNF,
            data: nfe.data_emissao,          // YYYY-MM-DD — Supabase date column
            numero: nfe.numero,
            chave_acesso: nfe.chave_acesso || null,
            cliente_nf: nfe.razao_destinatario || 'Consumidor Final',
            cfop: nfe.cfop,
            valor: nfe.valor_total,
            conciliada: false,
            cancelada: false,
          }

          // NF-e com chave de acesso — upsert por chave
          if (nfe.chave_acesso) {
            const { data: existente } = await supabase
              .from('notas_fiscais')
              .select('id')
              .eq('chave_acesso', nfe.chave_acesso)
              .eq('cliente_id', clienteId)
              .maybeSingle()

            if (existente) {
              await supabase.from('notas_fiscais').update(dadosNF).eq('id', existente.id)
              duplicados.push({
                arquivo: file.nome,
                numero: nfe.numero ?? '?',
                motivo: 'Atualizada (já existia)',
                detalhe: `NF ${nfe.numero} | Período: ${periodoNF} | Valor: R$ ${nfe.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              })
              return
            }
          } else if (nfe.numero) {
            // NFS-e sem chave — dedup por número + período
            let q = supabase
              .from('notas_fiscais')
              .select('id, valor')
              .eq('cliente_id', clienteId)
              .eq('numero', nfe.numero)
              .eq('periodo', periodoNF)
              .is('chave_acesso', null)

            if (nfe.razao_destinatario) {
              q = q.eq('cliente_nf', nfe.razao_destinatario)
            }

            const { data: existente } = await q.maybeSingle()
            if (existente) {
              await supabase.from('notas_fiscais').update(dadosNF).eq('id', existente.id)
              duplicados.push({
                arquivo: file.nome,
                numero: nfe.numero,
                motivo: 'Atualizada (já existia)',
                detalhe: `NF ${nfe.numero} | Período: ${periodoNF} | Valor anterior: R$ ${Number(existente.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              })
              return
            }
          }

          // Insere nova NF
          const { error: insertError } = await supabase.from('notas_fiscais').insert({
            id: crypto.randomUUID(),
            ...dadosNF,
          })

          if (insertError) {
            erros.push({ arquivo: file.nome, erro: insertError.message })
            return
          }

          const label = nfe.formato === 'nfse' ? 'NFS-e' : 'NF-e'
          const aviso = periodoNF !== periodo ? ` → alocado em ${periodoNF}` : ''
          importados.push(`${label} ${nfe.numero}${aviso} — R$ ${nfe.valor_total.toLocaleString('pt-BR')}`)

        } catch (fileErr) {
          erros.push({
            arquivo: file.nome,
            erro: fileErr instanceof Error ? fileErr.message : 'Erro inesperado ao processar arquivo',
          })
        }
      }))
    }

    return NextResponse.json({ importados, erros, duplicados, cancelamentos })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[importar-nfe]', msg)
    return NextResponse.json({ erro: `Erro interno: ${msg}` }, { status: 500 })
  }
}
