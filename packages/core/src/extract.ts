import { extractText as extractPdfText } from 'unpdf';

/** Plain text from an uploaded file. Accepts .txt, .md and .pdf. */
export async function extractText(bytes: Uint8Array, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    return new TextDecoder().decode(bytes);
  }
  if (ext === 'pdf') {
    // pdf.js may detach the buffer it is given; hand it a copy.
    const { text } = await extractPdfText(new Uint8Array(bytes), { mergePages: true });
    return text;
  }
  throw new Error(`Unsupported file type ".${ext}". Upload a .txt, .md or .pdf file.`);
}
