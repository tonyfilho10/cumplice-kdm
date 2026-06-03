import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseNFeXML } from '@/lib/parsers/nfe'
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
    const erros: { arquivo: string; erro: string }[] = []
    const duplicados: string[] = []

    // ── Processa em lotes de 10 em paralelo ───────────────────────────────
    const LOTE = 10
    for (let i = 0; i < files.length; i += LOTE) {
      const lote = files.slice(i, i + LOTE)

      await Promise.all(lote.map(async (file) => {
        const content = await file.text()
        const nfe = await parseNFeXML(content)

        if (nfe.erro) { erros.push({ arquivo: file.name, erro: nfe.erro }); return }

        const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo
        if (!periodoNF) { erros.push({ arquivo: file.name, erro: 'Data de emissão inválida' }); return }

        if (nfe.chave_acesso) {
          const existente = await prisma.notaFiscal.findUnique({
            where: { chave_acesso: nfe.chave_acesso },
            select: { id: true },
          })
          if (existente) { duplicados.push(`NF ${nfe.numero}`); return }
        } else if (nfe.numero && nfe.cnpj_emitente) {
          const existente = await prisma.notaFiscal.findFirst({
            where: { cliente_id: clienteId, numero: nfe.numero, chave_acesso: null },
            select: { id: true },
          })
          if (existente) { duplicados.push(`NF ${nfe.numero} (número duplicado)`); return }
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

    return NextResponse.json({ importados, erros, duplicados })
  } catch (err) {
    console.error('[importar-nfe]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
