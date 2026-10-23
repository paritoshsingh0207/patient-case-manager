export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export type AttachmentCategory = 'lab-report' | 'imaging' | 'referral' | 'other';

export const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  'lab-report': 'Lab report',
  imaging: 'Imaging / scan',
  referral: 'Referral / clinical letter',
  other: 'Other clinical attachment',
};

export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export function sanitizedAttachmentName(name: string): string {
  const stripped = name.replace(/[\\/\x00-\x1f\x7f]/g, '_').trim();
  return stripped.slice(0, 160) || 'clinical-attachment';
}

export function isAttachmentCategory(value: string): value is AttachmentCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

export function validateAttachmentDetails(input: {
  name: string; size: number; type: string; category: string; description: string;
}): void {
  const extension = input.name.split('.').at(-1)?.toLowerCase();
  const expected = input.type === 'application/pdf' ? 'pdf'
    : input.type === 'image/jpeg' ? 'jpg,jpeg'
    : input.type === 'image/png' ? 'png' : '';
  if (!ALLOWED_ATTACHMENT_TYPES.some(type => type === input.type) ||
      !extension || !expected.split(',').includes(extension)) {
    throw Error('Only PDF, JPEG, and PNG files with matching extensions can be uploaded.');
  }
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_ATTACHMENT_BYTES) {
    throw Error('The attachment must be between 1 byte and 10 MB.');
  }
  if (!isAttachmentCategory(input.category)) throw Error('Select a valid attachment category.');
  if (input.description.trim().length > 500) {
    throw Error('Attachment description must be 500 characters or less.');
  }
}

export function matchesAttachmentSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'application/pdf') {
    return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
      bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  }
  if (type === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/png') {
    return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  }
  return false;
}

export async function inspectAttachmentFile(file: File, category: string, description: string): Promise<void> {
  validateAttachmentDetails({ name: file.name, size: file.size, type: file.type, category, description });
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!matchesAttachmentSignature(signature, file.type)) {
    throw Error('File contents do not match the selected PDF or image format.');
  }
}
