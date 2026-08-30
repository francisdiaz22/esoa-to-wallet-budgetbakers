import { describe, expect, it } from 'vitest';
import {
  PdfTextExtractor,
  ScannedPdfOcrExtractor,
  repairCommonOcrArtifacts,
  type OcrEngine,
  type ValidatedInput,
} from './extractors.js';
import { TemporaryWorkspace } from './workspace.js';
import { LIMITS } from './limits.js';
import type { TextLine } from './contracts.js';

function makeTextPdf(text: string, pageCount = 1): Buffer {
  const firstPageObject = 3;
  const contentObject = firstPageObject + pageCount;
  const fontObject = contentObject + 1;
  const pageIds = Array.from(
    { length: pageCount },
    (_, index) => firstPageObject + index,
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageIds.map(
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    ),
    `<< /Length ${text.length + 35} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe('PdfTextExtractor', () => {
  it('uses the PDFParse class API and returns native text', async () => {
    const buffer = makeTextPdf('Native text extraction works locally');
    const input: ValidatedInput = {
      fieldName: 'statement',
      files: [
        {
          buffer,
          originalName: 'native.pdf',
          mimeHint: 'application/pdf',
          detectedMime: 'application/pdf',
          size: buffer.length,
        },
      ],
    };
    const workspace = new TemporaryWorkspace('pdf-text-test');
    try {
      const result = await new PdfTextExtractor().extract(input, workspace);
      expect(result.sourceFormat).toBe('pdf-text');
      expect(result.lines.map((line) => line.text).join(' ')).toContain(
        'Native text extraction works locally',
      );
    } finally {
      workspace.clear();
    }
  });

  it('rejects PDFs above the decoded page limit before text extraction', async () => {
    const buffer = makeTextPdf(
      'This PDF has usable native text on every generated page',
      LIMITS.MAX_PAGE_COUNT + 1,
    );
    const input = pdfInput(buffer);
    const workspace = new TemporaryWorkspace('pdf-page-limit-test');
    try {
      await expect(
        new PdfTextExtractor().extract(input, workspace),
      ).rejects.toMatchObject({ code: 'pdf_page_limit' });
    } finally {
      workspace.clear();
    }
  });
});

class CapturingOcrEngine implements OcrEngine {
  readonly id = 'capturing-ocr';
  images: { buffer: Buffer; page: number }[] = [];

  isAvailable(): boolean {
    return true;
  }

  async extract(
    images: { buffer: Buffer; page: number }[],
  ): Promise<TextLine[]> {
    this.images = images;
    return images.map((image, index) => ({
      page: image.page,
      order: index + 1,
      text: 'BDO VISA GOLD Sale Date Description Amount',
      confidence: 0.9,
    }));
  }
}

function pdfInput(buffer: Buffer): ValidatedInput {
  return {
    fieldName: 'statement',
    files: [
      {
        buffer,
        originalName: 'scan.pdf',
        mimeHint: 'application/pdf',
        detectedMime: 'application/pdf',
        size: buffer.length,
      },
    ],
  };
}

describe('ScannedPdfOcrExtractor', () => {
  it('renders every PDF page to bounded in-memory PNG data before OCR', async () => {
    const buffer = makeTextPdf('', 2);
    const engine = new CapturingOcrEngine();
    const workspace = new TemporaryWorkspace('pdf-render-test');
    try {
      const result = await new ScannedPdfOcrExtractor(engine).extract(
        pdfInput(buffer),
        workspace,
      );

      expect(result.pages).toBe(2);
      expect(engine.images.map((image) => image.page)).toEqual([1, 2]);
      expect(
        engine.images.every(
          (image) => image.buffer.subarray(1, 4).toString('ascii') === 'PNG',
        ),
      ).toBe(true);
    } finally {
      workspace.clear();
    }
  });
});

describe('OCR artifact repair', () => {
  it('repairs mixed I/l glyphs, date-column junk, and impossible consonant duplication', () => {
    expect(
      repairCommonOcrArtifacts(
        '07/29/26 07/29/26 PC EXPRESS SM NORTH Il QUEZON CITY PH',
      ),
    ).toContain('NORTH II QUEZON');
    expect(
      repairCommonOcrArtifacts('06/28/26 06/30/26 ~~ SHOPEE PH MANDALUYONG PH'),
    ).not.toContain('~~');
    expect(repairCommonOcrArtifacts('MR DIY WMLL MALOLOS PH')).toContain(
      'DIY WML MALOLOS',
    );
    expect(repairCommonOcrArtifacts('KLOOK FLICKKET TAGUIG PH')).toContain(
      'KLOOK FLICKET TAGUIG',
    );
  });

  it('preserves legitimate doubled vowels and terminal consonants', () => {
    expect(repairCommonOcrArtifacts('KLOOK SHELL-EMERIGOLD')).toBe(
      'KLOOK SHELL-EMERIGOLD',
    );
  });
});
