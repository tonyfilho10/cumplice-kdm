// Manipulação de PDF no browser (split/merge por página) usando pdf-lib
import { PDFDocument } from 'pdf-lib'

export async function contarPaginas(file: File): Promise<number> {
  const bytes = await file.arrayBuffer()
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

// Extrai uma única página (0-indexed) como um novo PDF
export async function extrairPagina(file: File, indice: number): Promise<Blob> {
  const bytes = await file.arrayBuffer()
  const origem = await PDFDocument.load(bytes)
  const novo = await PDFDocument.create()
  const [pagina] = await novo.copyPages(origem, [indice])
  novo.addPage(pagina)
  const out = await novo.save()
  return new Blob([new Uint8Array(out)], { type: 'application/pdf' })
}

// Junta várias páginas (já extraídas como PDFs de 1 página) em um único PDF
export async function juntarPaginas(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0]

  const novo = await PDFDocument.create()
  for (const blob of blobs) {
    const bytes = await blob.arrayBuffer()
    const origem = await PDFDocument.load(bytes)
    const paginas = await novo.copyPages(origem, origem.getPageIndices())
    for (const pagina of paginas) novo.addPage(pagina)
  }
  const out = await novo.save()
  return new Blob([new Uint8Array(out)], { type: 'application/pdf' })
}
