import { extname } from 'node:path';
import { open } from 'node:fs/promises';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';
const types: Record<string, [PreviewKind, string]> = {
  '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.png': ['image', 'image/png'],
  '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'], '.bmp': ['image', 'image/bmp'],
  '.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'], '.mov': ['video', 'video/quicktime'],
  '.mp3': ['audio', 'audio/mpeg'], '.wav': ['audio', 'audio/wav'], '.ogg': ['audio', 'audio/ogg'], '.m4a': ['audio', 'audio/mp4'],
  '.pdf': ['pdf', 'application/pdf'],
};
const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.yaml', '.yml', '.ts', '.js', '.css', '.html', '.htm', '.svg', '.py', '.sql']);
export function previewType(name: string): { kind: PreviewKind; mime: string } {
  const extension = extname(name).toLowerCase();
  const entry = types[extension];
  if (entry) return { kind: entry[0], mime: entry[1] };
  if (textExtensions.has(extension)) return { kind: 'text', mime: 'text/plain; charset=utf-8' };
  return { kind: 'unsupported', mime: 'application/octet-stream' };
}
export async function inspectPreview(path: string, name: string) {
  const type = previewType(name);
  if (type.kind === 'unsupported') return type;
  const file = await open(path, 'r');
  const header = Buffer.alloc(512);
  try {
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const ascii = bytes.toString('latin1');
    const valid = type.kind === 'text' ? !bytes.includes(0)
      : type.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : type.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type.mime === 'image/gif' ? /^GIF8[79]a/.test(ascii)
      : type.mime === 'image/webp' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
      : type.mime === 'image/bmp' ? ascii.startsWith('BM')
      : type.kind === 'pdf' ? ascii.startsWith('%PDF-')
      : type.mime === 'audio/wav' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'
      : type.mime === 'audio/ogg' ? ascii.startsWith('OggS')
      : type.mime === 'audio/mpeg' ? ascii.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)
      : type.mime === 'video/webm' ? bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))
      : ascii.slice(4,8) === 'ftyp';
    return valid ? type : { kind: 'unsupported' as const, mime: 'application/octet-stream' };
  } finally { await file.close(); }
}
