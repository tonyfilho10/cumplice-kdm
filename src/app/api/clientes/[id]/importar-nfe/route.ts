import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseNFeXML, parseEventoNFe } from '@/lib/parsers/nfe'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { verificarPeriodoAberto } from '@/lib/supabase/periodo-guard'
import { conciliarPeriodo } from '@/lib/conciliar'

// Aumenta limite de body para importação em lote
export const maxDuration = 60 // 60s no Netlify/Vercel

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clienteId } = await params
  const guard = await guardCliente(clienteId)
  if (!guard.ok) return guard.response

  try {
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]
    const periodo = formData.get('periodo') as string

    if (!periodo) return NextResponse.json({ erro: 'Período obrigatório' }, { status: 400 })

    const periodoGuard = await verificarPeriodoAberto(clienteId, periodo)
    if (!periodoGuard.ok) return periodoGuard.response

    const importados: string[] = []
    const erros: { arquivo: string; erro: string; detalhe?: string }[] = []
    const duplicados: { arquivo: string; numero: string; motivo: string; detalhe: string }[] = []
    const cancelamentos: string[] = []

    // ── Processa em lotes de 10 em paralelo ───────────────────────────────
    const LOTE = 10
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE)

      await Promise.all(lote.map(async (file) => {
        const content = await file.text()
        const nfe = await parseNFeXML(content)

        if (nfe.erro) {
          // Arquivos ignorados silenciosamente (consultas, inutilizações)
          if (nfe.erro.startsWith('Arquivo ignorado:')) return

          // Evento de cancelamento ou CCe — processa separadamente
          if (nfe.erro === '__evento__') {
            const evento = parseEventoNFe(content)
            if (evento && evento.tipo === 'cancelamento' && evento.chave_nfe) {
              // Marca a NF como cancelada pelo chave_acesso
              const nfExistente = await prisma.notaFiscal.findFirst({
                where: { chave_acesso: evento.chave_nfe, cliente_id: clienteId },
                select: { id: true, numero: true },
              })
              if (nfExistente) {
                await prisma.notaFiscal.update({
                  where: { id: nfExistente.id },
                  data: { cancelada: true },
                })
                cancelamentos.push(`NF ${nfExistente.numero} cancelada — ${evento.descricao}`)
              } else {
                // NF não importada ainda — registra aviso mas não é erro
                cancelamentos.push(`Cancelamento recebido para chave ${evento.chave_nfe.substring(0, 10)}... (NF não encontrada no sistema)`)
              }
            } else if (evento && evento.tipo === 'carta_correcao') {
              // CCe não altera dados fiscais — apenas registra informação
              cancelamentos.push(`Carta de Correção para chave ${evento.chave_nfe.substring(0, 10)}... — ${evento.descricao} (sem impacto nos valores)`)
            }
            return
          }

          erros.push({
            arquivo: file.name,
            erro: nfe.erro,
            detalhe: `Arquivo: ${file.name} — verifique se o XML está correto e não está corrompido`,
          })
          return
        }

        const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo
        if (!periodoNF) {
          erros.push({ arquivo: file.name, erro: 'Data de emissão inválida', detalhe: 'O XML não contém data de emissão legível' })
          return
        }

        // ── Deduplicação: APENAS por chave de acesso (NF-e) ou número+data+emitente (NFS-e) ──
        // Não considera duplicata apenas por cliente+valor (podem existir múltiplas NFs iguais)
        if (nfe.chave_acesso) {
          // NF-e: chave de acesso é única no Brasil — critério definitivo
          const existente = await prisma.notaFiscal.findUnique({
            where: { chave_acesso: nfe.chave_acesso },
            select: { id: true, numero: true, periodo: true },
          })
          if (existente) {
            duplicados.push({
              arquivo: file.name,
              numero: nfe.numero ?? '?',
              motivo: 'Chave de acesso já importada',
              detalhe: `Chave: ${nfe.chave_acesso} | Período já registrado: ${existente.periodo}`,
            })
            return
          }
        } else if (nfe.numero) {
          // NFS-e ou XML sem chave: dedup por número + período + destinatário (não só pelo número)
          const existente = await prisma.notaFiscal.findFirst({
            where: {
              cliente_id: clienteId,
              numero: nfe.numero,
              periodo: periodoNF,
              chave_acesso: null,
              // Adiciona destinatário ao critério para evitar falsos positivos
              ...(nfe.razao_destinatario ? { cliente_nf: nfe.razao_destinatario } : {}),
            },
            select: { id: true, numero: true, periodo: true, valor: true },
          })
          if (existente) {
            duplicados.push({
              arquivo: file.name,
              numero: nfe.numero,
              motivo: 'NFS-e com mesmo número, período e destinatário já importada',
              detalhe: `NF ${nfe.numero} | Período: ${periodoNF} | Valor já registrado: R$ ${Number(existente.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            })
            return
          }
        }

        await prisma.notaFiscal.create({
          data: {
            cliente_id: clienteId,
            periodo: periodoNF,
            data: new Date(nfe.data_emissao),
            numero: nfe.numero,
            chave_acesso: nfe.chave_acesso || null,
            cliente_nf: nfe.razao_destinatario || 'Consumidor Final',
            cfop: nfe.cfop, valor: nfe.valor_total, conciliada: false,
          },
        })
        const label = nfe.formato === 'nfse' ? 'NFS-e' : 'NF-e'
        const aviso = periodoNF !== periodo ? ` → alocado em ${periodoNF}` : ''
        importados.push(`${label} ${nfe.numero}${aviso} — R$ ${nfe.valor_total.toLocaleString('pt-BR')}`)
      }))
    }

    // Concilia períodos das NFs importadas
    const periodosImportados = [...new Set(importados.map(s => {
      const m = s.match(/→ alocado em (\d{4}-\d{2})/)
      return m ? m[1] : periodo
    }))]
    for (const p of periodosImportados) {
      try { await conciliarPeriodo(clienteId, p) } catch { }
    }

    return NextResponse.json({ importados, erros, duplicados, cancelamentos })
  } catch (err) {
    console.error('[importar-nfe]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
