// Divisão de PDFs em sub-arquivos por intervalo de páginas (server-side)
import { PDFDocument } from 'pdf-lib'

// `paginas` é 1-indexed
export async function dividirPdf(buffer: Buffer, paginas: number[]): Promise<Buffer> {
  const origem = await PDFDocument.load(buffer)
  const novo = await PDFDocument.create()

  const indices = paginas.map(p => p - 1).filter(i => i >= 0 && i < origem.getPageCount())
  const copiadas = await novo.copyPages(origem, indices)
  for (const pagina of copiadas) novo.addPage(pagina)

  const bytes = await novo.save()
  return Buffer.from(bytes)
}

export async function contarPaginasPdf(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer)
  return doc.getPageCount()
}
