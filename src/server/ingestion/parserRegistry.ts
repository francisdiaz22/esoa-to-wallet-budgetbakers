import type { ExtractedDocument, ParserMatch } from './contracts.js';
import type { BankParser } from './bdoParser.js';

export class ParserRegistry {
  constructor(private parsers: BankParser[]) {}

  findBestMatch(document: ExtractedDocument): {
    parser: BankParser | null;
    match: ParserMatch;
  } {
    const matches: { parser: BankParser; match: ParserMatch }[] = [];
    for (const p of this.parsers) {
      const m = p.canParse(document);
      if (m.matched) matches.push({ parser: p, match: m });
    }
    if (matches.length === 0) {
      return {
        parser: null,
        match: {
          matched: false,
          score: 0,
          reason: 'no parser recognized layout',
        },
      };
    }
    // sort descending score
    matches.sort((a, b) => b.match.score - a.match.score);
    if (matches.length > 1) {
      const top = matches[0].match.score;
      const second = matches[1].match.score;
      // Tie or ambiguous: if difference < 0.1 or both high
      if (Math.abs(top - second) < 0.05) {
        return {
          parser: null,
          match: {
            matched: false,
            score: top,
            reason: 'ambiguous parser match (tie)',
          },
        };
      }
    }
    return matches[0];
  }

  /** Threshold documented: registry selects only when single confident match */
  getThreshold(): number {
    return 0.55;
  }
}
