import { XMLParser } from 'fast-xml-parser'
import fs from 'fs'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: true })
const xml = fs.readFileSync('C:/Users/louri/Downloads/26260511594485000105650010000314461119457726.xml', 'utf8')
const result = parser.parse(xml)

console.log('Root keys:', Object.keys(result))
const root = result.nfeProc
console.log('nfeProc:', root ? 'FOUND' : 'NOT FOUND')
if (root) {
  console.log('nfeProc keys:', Object.keys(root))
  const nfe = root.NFe
  if (nfe) {
    console.log('NFe keys:', Object.keys(nfe))
    const infNFe = nfe.infNFe
    if (infNFe) {
      console.log('infNFe.ide.nNF:', infNFe.ide?.nNF)
      console.log('infNFe.total:', JSON.stringify(infNFe.total, null, 2))
    } else {
      console.log('infNFe: NOT FOUND. NFe keys:', Object.keys(nfe))
    }
  }
}
