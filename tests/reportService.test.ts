import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_REPORT_TEXT_BYTES, prepareReviewedReport,
} from '../src/services/reportService';

describe('reviewed patient reports', () => {
  const pages = [
    { number: 1, text: 'Hemoglobin 13.8 g/dL', method: 'text-layer' as const },
    { number: 2, text: 'HbA1c 5.9%', method: 'ocr' as const },
  ];

  it('preserves reviewed text and page boundaries without PDF bytes', () => {
    const result = prepareReviewedReport('  Lab Report Nov.pdf  ', pages);
    expect(result.reportName).toBe('Lab Report Nov.pdf');
    expect(result.pageCount).toBe(2);
    expect(result.ocrUsed).toBe(true);
    expect(result.content).toContain('Page 1\nHemoglobin 13.8 g/dL');
    expect(result.content).toContain('Page 2\nHbA1c 5.9%');
    expect(result).not.toHaveProperty('pdf');
    expect(result).not.toHaveProperty('file');
    expect(result).not.toHaveProperty('image');
  });

  it('rejects empty text, bad names, page gaps and oversized report content', () => {
    expect(() => prepareReviewedReport(' ', pages)).toThrow(/name/i);
    expect(() => prepareReviewedReport('X'.repeat(121), pages)).toThrow(/name/i);
    expect(() => prepareReviewedReport('valid', [])).toThrow(/1 and 50/);
    expect(() => prepareReviewedReport('valid', [
      { number: 2, text: 'test', method: 'ocr' },
    ])).toThrow(/order/);
    expect(() => prepareReviewedReport('valid', [
      { number: 1, text: '  ', method: 'unreadable' },
    ])).toThrow(/No report text/);
    expect(() => prepareReviewedReport('valid', [
      { number: 1, text: '🔥'.repeat(MAX_SAVED_REPORT_TEXT_BYTES / 4), method: 'ocr' },
    ])).toThrow(/too long/);
  });
});
