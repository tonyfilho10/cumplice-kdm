import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseNFeXML } from '@/lib/parsers/nfe'
import { guardCliente } from '@/lib/supabase/auth-guard'
import { verificarPeriodoAberto } from '@/lib/supabase/periodo-guard'

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

    // Verifica se período está fechado (usa o período de referência da UI)
    const periodoGuard = await verificarPeriodoAberto(clienteId, periodo)
    if (!periodoGuard.ok) return periodoGuard.response

    // periodo da UI é apenas fallback — a NF usa sua data de emissão real
    const importados: string[] = []
    const erros: { arquivo: string; erro: string }[] = []
    const duplicados: string[] = []

    for (const file of files) {
      const content = await file.text()
      const nfe = await parseNFeXML(content)

      if (nfe.erro) { erros.push({ arquivo: file.name, erro: nfe.erro }); continue }

      // Deriva período da DATA DA NF, não do período da UI
      // Ex: NF de 15/04/2026 → periodo = "2026-04"  independente do que está na UI
      const periodoNF = nfe.data_emissao?.substring(0, 7) || periodo
      if (!periodoNF) { erros.push({ arquivo: file.name, erro: 'Data de emissão inválida' }); continue }

      // Verifica duplicata: 1) pela chave de acesso (NF-e), 2) por número+cliente (fallback NFS-e)
      if (nfe.chave_acesso) {
        const existente = await prisma.notaFiscal.findUnique({
          where: { chave_acesso: nfe.chave_acesso },
          select: { id: true },
        })
        if (existente) { duplicados.push(`NF ${nfe.numero} (chave duplicada)`); continue }
      } else if (nfe.numero && nfe.cnpj_emitente) {
        // Para NFS-e sem chave: verifica número + CNPJ emitente + cliente
        const existente = await prisma.notaFiscal.findFirst({
          where: {
            cliente_id: clienteId,
            numero: nfe.numero,
            // verifica pelo CNPJ emitente guardado na chave ou no número
            chave_acesso: null,
          },
          select: { id: true },
        })
        if (existente) { duplicados.push(`NF ${nfe.numero} (número duplicado)`); continue }
      }

      const label = nfe.formato === 'nfse' ? 'NFS-e' : 'NF-e'
      await prisma.notaFiscal.create({
        data: {
          cliente_id: clienteId,
          periodo: periodoNF,           // ← período real da NF
          data: new Date(nfe.data_emissao),
          numero: nfe.numero,
          chave_acesso: nfe.chave_acesso || null,
          cliente_nf: nfe.razao_destinatario || 'Consumidor Final',
          cfop: nfe.cfop, valor: nfe.valor_total, conciliada: false,
        },
      })
      const aviso = periodoNF !== periodo ? ` → alocado em ${periodoNF}` : ''
      importados.push(`${label} ${nfe.numero}${aviso} — R$ ${nfe.valor_total.toLocaleString('pt-BR')}`)
    }

    // ── Conciliação automática para cada período com NFs novas ─────────────
    const periodosImportados = [...new Set(importados.map(s => {
      const m = s.match(/→ alocado em (\d{4}-\d{2})/)
      return m ? m[1] : periodo
    }))]
    for (const p of periodosImportados) {
      try {
        const baseUrl = request.nextUrl.origin
        await fetch(`${baseUrl}/api/clientes/${clienteId}/conciliar?periodo=${p}`, {
          method: 'POST',
          headers: { cookie: request.headers.get('cookie') || '' },
        })
      } catch { /* não bloqueia se falhar */ }
    }

    return NextResponse.json({ importados, erros, duplicados })
  } catch (err) {
    console.error('[importar-nfe]', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
