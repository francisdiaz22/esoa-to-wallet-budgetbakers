import type { TextLine } from './contracts.js';

/**
 * Generates synthetic OCR TextLines for the BDO fixture.
 * Marked synthetic; never commit real OCR output.
 * Uses expected_extraction.csv literals to ensure oracle fidelity.
 * Includes BDO anchors and continuation examples.
 */

type RawRow = {
  source_row_id: string;
  page: number;
  include: string;
  sale_date: string;
  description: string;
  raw_amount: string;
  exclusion_reason: string;
};

const ROWS: RawRow[] = [
  {
    source_row_id: 'p1-x001',
    page: 1,
    include: 'false',
    sale_date: '',
    description: 'PREVIOUS STATEMENT BALANCE',
    raw_amount: '22886.77',
    exclusion_reason: 'previous-balance',
  },
  {
    source_row_id: 'p1-r001',
    page: 1,
    include: 'true',
    sale_date: '2026-07-29',
    description: 'PC EXPRESS SM NORTH II QUEZON CITY PH | INSTALMENT 5 OF 12',
    raw_amount: '828.33',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r002',
    page: 1,
    include: 'true',
    sale_date: '2026-07-29',
    description: 'MONTHLY MEMBERSHIP FEE',
    raw_amount: '200.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r003',
    page: 1,
    include: 'true',
    sale_date: '2026-07-29',
    description: 'SKECHERS PASEO LAGUNA PH | INSTALMENT 4 OF 6',
    raw_amount: '1885.42',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r004',
    page: 1,
    include: 'true',
    sale_date: '2026-07-29',
    description: 'IKEA PASAY PH | INSTALMENT 2 OF 3',
    raw_amount: '3547.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r005',
    page: 1,
    include: 'true',
    sale_date: '2026-07-29',
    description: 'ACE HARDWARE-MALOLOS BULACAN PH | INSTALMENT 1 OF 3',
    raw_amount: '1632.60',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r006',
    page: 1,
    include: 'true',
    sale_date: '2026-06-28',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '1869.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r007',
    page: 1,
    include: 'true',
    sale_date: '2026-06-29',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '394.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r008',
    page: 1,
    include: 'true',
    sale_date: '2026-07-04',
    description: 'CONTIS MALOLOS BULACAN PH',
    raw_amount: '4054.02',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r009',
    page: 1,
    include: 'true',
    sale_date: '2026-07-05',
    description: 'MCDO 781 BALAGTAS BALAGTAS PH',
    raw_amount: '138.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r010',
    page: 1,
    include: 'true',
    sale_date: '2026-07-06',
    description: 'GREATFIT MAKERS-HO PASIG CITY PH',
    raw_amount: '1859.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r011',
    page: 1,
    include: 'true',
    sale_date: '2026-07-06',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '1331.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r012',
    page: 1,
    include: 'true',
    sale_date: '2026-07-07',
    description: 'WATSONS WALTERMART MAL BULACAN PH',
    raw_amount: '1621.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r013',
    page: 1,
    include: 'true',
    sale_date: '2026-07-07',
    description: 'MR DIY WML MALOLOS PH',
    raw_amount: '317.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r014',
    page: 1,
    include: 'true',
    sale_date: '2026-07-07',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '99.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p1-r015',
    page: 1,
    include: 'true',
    sale_date: '2026-07-07',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '129.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r016',
    page: 2,
    include: 'true',
    sale_date: '2026-07-07',
    description: 'SHOPEE PH MANDALUYONG PH',
    raw_amount: '469.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r017',
    page: 2,
    include: 'true',
    sale_date: '2026-07-08',
    description: 'HEALTHY OPTIONS TAGUIG PH',
    raw_amount: '529.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r018',
    page: 2,
    include: 'true',
    sale_date: '2026-07-08',
    description: 'THE MARKETPLACE UPTO TAGUIG CITY PH',
    raw_amount: '188.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r019',
    page: 2,
    include: 'true',
    sale_date: '2026-07-08',
    description: 'GLOBE-BILLSPAY TAGUIG CITY PH',
    raw_amount: '999.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r020',
    page: 2,
    include: 'true',
    sale_date: '2026-07-08',
    description: '7-ELEVEN-ST2514 FORT BONIFACI PH',
    raw_amount: '100.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r021',
    page: 2,
    include: 'true',
    sale_date: '2026-07-09',
    description: 'WDEPT STORE-MALOLOS BU BULACAN PH',
    raw_amount: '1099.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r022',
    page: 2,
    include: 'true',
    sale_date: '2026-07-09',
    description: 'SHELL-EMERIGOLD-MALOLO BULACAN PH',
    raw_amount: '1400.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r023',
    page: 2,
    include: 'true',
    sale_date: '2026-07-09',
    description: 'KLOOK FLICKET TAGUIG PH',
    raw_amount: '3732.50',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r024',
    page: 2,
    include: 'true',
    sale_date: '2026-07-09',
    description: 'KLOOK FLICKET TAGUIG PH',
    raw_amount: '1379.30',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r025',
    page: 2,
    include: 'true',
    sale_date: '2026-07-10',
    description: 'RE BALER AURORA AURORA PH',
    raw_amount: '550.50',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r026',
    page: 2,
    include: 'true',
    sale_date: '2026-07-10',
    description: 'CLDCMERCURYDRUG3018 RIZAL PH',
    raw_amount: '52.50',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r027',
    page: 2,
    include: 'true',
    sale_date: '2026-07-10',
    description: 'CLDCMERCURYDRUG3018 RIZAL PH',
    raw_amount: '998.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r028',
    page: 2,
    include: 'true',
    sale_date: '2026-07-10',
    description: 'MCDONALDS RIZAL FC RIZAL PH',
    raw_amount: '423.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r029',
    page: 2,
    include: 'true',
    sale_date: '2026-07-11',
    description: 'BAYS INN RESORT AURORA PH',
    raw_amount: '1056.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r030',
    page: 2,
    include: 'true',
    sale_date: '2026-07-12',
    description: 'JOLLIBEE JB3283 CP CONCEPCION PH',
    raw_amount: '275.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r031',
    page: 2,
    include: 'true',
    sale_date: '2026-07-12',
    description: 'MANGINASAL MI3130 CONCEPCION PH',
    raw_amount: '165.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-r032',
    page: 2,
    include: 'true',
    sale_date: '2026-07-12',
    description: 'RE-BALER AURORA AURORA PH',
    raw_amount: '1512.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p2-x002',
    page: 2,
    include: 'false',
    sale_date: '2026-07-24',
    description: 'PAYMENT RECEIVED - THANK YOU',
    raw_amount: '-22886.77',
    exclusion_reason: 'credit-card-payment',
  },
  {
    source_row_id: 'p3-r033',
    page: 3,
    include: 'true',
    sale_date: '2026-07-27',
    description: 'GRAB PASIG CITY PH',
    raw_amount: '125.00',
    exclusion_reason: '',
  },
  {
    source_row_id: 'p3-x003',
    page: 3,
    include: 'false',
    sale_date: '',
    description: 'SUBTOTAL',
    raw_amount: '34957.17',
    exclusion_reason: 'summary',
  },
  {
    source_row_id: 'p3-x004',
    page: 3,
    include: 'false',
    sale_date: '',
    description: 'TOTAL',
    raw_amount: '34957.17',
    exclusion_reason: 'summary',
  },
];

export function generateSyntheticBdoLines(): TextLine[] {
  const lines: TextLine[] = [];
  let order = 1;

  // Add BDO anchors on page 1 to ensure parser detection
  lines.push({
    page: 1,
    order: order++,
    text: 'BDO VISA GOLD',
    confidence: 0.99,
  });
  lines.push({
    page: 1,
    order: order++,
    text: 'Statement Date Jul 29, 2026',
    confidence: 0.99,
  });
  lines.push({
    page: 1,
    order: order++,
    text: 'Sale Date Post Date Description Amount (PHP)',
    confidence: 0.99,
  });

  for (const row of ROWS) {
    if (row.include === 'false') {
      // Excluded rows rendered as separate lines with appropriate labels
      let txt: string;
      if (row.exclusion_reason === 'previous-balance') {
        txt = `${row.description} ${row.raw_amount}`;
      } else if (row.exclusion_reason === 'credit-card-payment') {
        // payment may have date present but we render as description
        txt = `${row.description} ${row.raw_amount}`;
      } else {
        txt = `${row.description} ${row.raw_amount}`;
      }
      lines.push({
        page: row.page,
        order: order++,
        text: txt,
        confidence: 0.98,
      });
      continue;
    }
    // Included rows: need sale date MM-DD, description, amount
    const dateObj = row.sale_date ? new Date(row.sale_date) : null;
    const mmdd = dateObj
      ? `${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`
      : '07-01';
    // Split installment suffix if present
    const installParts = row.description.split(' | INSTALMENT ');
    const baseDesc = installParts[0];
    const lineText = `${mmdd} ${baseDesc} ${row.raw_amount}`;
    lines.push({
      page: row.page,
      order: order++,
      text: lineText,
      confidence: 0.98,
    });
    if (installParts.length > 1) {
      lines.push({
        page: row.page,
        order: order++,
        text: `INSTALMENT ${installParts[1]}`,
        confidence: 0.97,
      });
    }
    // No reference lines in this fixture
  }

  return lines;
}

export function getSyntheticBdoLinesForPages(pages: number[]): TextLine[] {
  const all = generateSyntheticBdoLines();
  return all.filter((l) => pages.includes(l.page));
}
