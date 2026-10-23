import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES, matchesAttachmentSignature, sanitizedAttachmentName, validateAttachmentDetails,
} from './attachmentValidation';

const valid = { name: 'cbc.pdf', size: 5000, type: 'application/pdf', category: 'lab-report', description: '' };

describe('clinical attachment validation', () => {
  it('accepts PDF/JPEG/PNG with correct extension', () => {
    expect(() => validateAttachmentDetails(valid)).not.toThrow();
    expect(() => validateAttachmentDetails({ ...valid, name: 'scan.JPEG', type: 'image/jpeg' })).not.toThrow();
    expect(() => validateAttachmentDetails({ ...valid, name: 'scan.png', type: 'image/png' })).not.toThrow();
  });
  it('rejects mismatched MIME/extension, excessive sizes and unknown categories', () => {
    for (const input of [
      { ...valid, name: 'danger.html', type: 'text/html' },
      { ...valid, name: 'danger.pdf', type: 'image/png' },
      { ...valid, size: MAX_ATTACHMENT_BYTES + 1 },
      { ...valid, size: 0 },
      { ...valid, category: 'unknown' },
      { ...valid, description: 'x'.repeat(501) },
    ]) expect(() => validateAttachmentDetails(input)).toThrow();
  });
  it('sniffs PDF and supported image signatures', () => {
    expect(matchesAttachmentSignature(new Uint8Array([37,80,68,70,45,49,46]),'application/pdf')).toBe(true);
    expect(matchesAttachmentSignature(new Uint8Array([255,216,255]),'image/jpeg')).toBe(true);
    expect(matchesAttachmentSignature(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png')).toBe(true);
    expect(matchesAttachmentSignature(new Uint8Array([60,104,116,109,108]),'application/pdf')).toBe(false);
  });
  it('never uses arbitrary path characters from the original filename', () => {
    expect(sanitizedAttachmentName('../report\\final.pdf')).toBe('.._report_final.pdf');
    expect(sanitizedAttachmentName('x'.repeat(400)).length).toBe(160);
  });
});
