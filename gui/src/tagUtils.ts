/**
 * Tag processing utilities for XLIFF/TMX inline tags.
 *
 * Converts verbose inline tags like <bpt id="1">&lt;strong&gt;</bpt> into
 * numbered placeholders like {1} for display, while preserving the original
 * tags for saving.
 */

export interface TagInfo {
  /** Sequential number (1, 2, 3...) */
  number: number;
  /** "open", "close", or "standalone" */
  type: 'open' | 'close' | 'standalone';
  /** The original tag string as it appears in the XLIFF */
  original: string;
  /** Paired tag number (for open/close pairs that share a number) */
  pairNumber?: number;
}

export interface ProcessedSegment {
  /** Display string with numbered placeholders */
  displayParts: SegmentPart[];
  /** Mapping from tag number to original tag info */
  tagMap: Map<number, TagInfo>;
  /** Original unprocessed text */
  original: string;
}

export type SegmentPart =
  | { type: 'text'; content: string }
  | { type: 'tag'; number: number; tagType: 'open' | 'close' | 'standalone'; original: string };

/**
 * Regex pattern that matches all inline tag types in XLIFF content.
 * Must stay in sync with getTagPattern() in App.tsx.
 */
const TAG_PATTERN = /(?:<(?:bpt|ept|ph|it|g|x|mrk|sub|ut)\b[^>]*>.*?<\/(?:bpt|ept|ph|it|g|x|mrk|sub|ut)>|<[^<>]+>|&lt;(?:[^&]|&[a-zA-Z]+;|&#x?[\da-fA-F]+;)*?&gt;|&amp;lt;(?:[^&]|&(?:amp|quot|apos|lt|gt|#x?[\da-fA-F]+);)*?&amp;gt;|&(?:[a-zA-Z]+|#x?[\da-fA-F]+);|\{[\w\d_]+\}|\[\d+\]|%(?:\d+\$)?[sd])/gs;

/**
 * Determine if a tag is opening, closing, or standalone.
 */
function classifyTag(tag: string): 'open' | 'close' | 'standalone' {
  // XLIFF paired tags
  if (/^<bpt\b/i.test(tag)) return 'open';
  if (/^<ept\b/i.test(tag)) return 'close';

  // Regular XML-style tags
  if (/^<\//.test(tag) || /^&lt;\//.test(tag) || /^&amp;lt;\//.test(tag)) return 'close';
  if (/\/>$/.test(tag) || /\/&gt;$/.test(tag) || /\/&amp;gt;$/.test(tag)) return 'standalone';

  // Self-closing XLIFF tags
  if (/^<(?:ph|x|it)\b/i.test(tag)) return 'standalone';

  // Entities and placeholders are standalone
  if (/^&(?:[a-zA-Z]+|#x?[\da-fA-F]+);$/.test(tag)) return 'standalone';
  if (/^\{[\w\d_]+\}$/.test(tag)) return 'standalone';
  if (/^\[\d+\]$/.test(tag)) return 'standalone';
  if (/^%(?:\d+\$)?[sd]$/.test(tag)) return 'standalone';

  // Opening XML tag
  if (/^<[^/]/.test(tag) || /^&lt;[^/]/.test(tag) || /^&amp;lt;[^/]/.test(tag)) return 'open';

  return 'standalone';
}

/**
 * Process a segment's text, extracting tags and assigning sequential numbers.
 * Opening/closing pairs share the same number.
 *
 * This is called once per segment when the file is loaded, NOT during rendering.
 */
export function processSegmentTags(text: string): ProcessedSegment {
  if (!text) {
    return { displayParts: [], tagMap: new Map(), original: '' };
  }

  const parts: SegmentPart[] = [];
  const tagMap = new Map<number, TagInfo>();

  // Reset regex
  TAG_PATTERN.lastIndex = 0;

  let lastIndex = 0;
  let nextNumber = 1;
  const openStack: { original: string; number: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_PATTERN.exec(text)) !== null) {
    // Add text before this tag
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
    }

    const tagStr = match[0];
    const tagType = classifyTag(tagStr);

    let tagNumber: number;

    if (tagType === 'open') {
      tagNumber = nextNumber++;
      openStack.push({ original: tagStr, number: tagNumber });
    } else if (tagType === 'close' && openStack.length > 0) {
      // Match with the most recent open tag
      const paired = openStack.pop()!;
      tagNumber = paired.number;
    } else {
      // Standalone or unmatched close
      tagNumber = nextNumber++;
    }

    const tagInfo: TagInfo = {
      number: tagNumber,
      type: tagType,
      original: tagStr,
    };

    tagMap.set(tagType === 'close' ? -tagNumber : tagNumber, tagInfo);
    parts.push({ type: 'tag', number: tagNumber, tagType: tagType, original: tagStr });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last tag
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.substring(lastIndex) });
  }

  return { displayParts: parts, tagMap, original: text };
}

/**
 * Check if a text contains any tags.
 */
export function hasTags(text: string): boolean {
  TAG_PATTERN.lastIndex = 0;
  return TAG_PATTERN.test(text);
}

/**
 * Get plain text (no tags) from a processed segment.
 */
export function getPlainText(processed: ProcessedSegment): string {
  return processed.displayParts
    .filter(p => p.type === 'text')
    .map(p => (p as { type: 'text'; content: string }).content)
    .join('');
}

/**
 * Build a display string with numbered placeholders (for simple string contexts).
 * E.g., "Hello {1}world{/1}, click {2}here{/2}"
 */
export function toDisplayString(processed: ProcessedSegment): string {
  return processed.displayParts.map(part => {
    if (part.type === 'text') return part.content;
    if (part.tagType === 'open') return `{${part.number}}`;
    if (part.tagType === 'close') return `{/${part.number}}`;
    return `{${part.number}}`;
  }).join('');
}

/**
 * Process all trans units in a file at load time.
 * Returns a map of unit ID → { source: ProcessedSegment, target: ProcessedSegment }
 */
export function processAllUnits(
  units: Array<{ id: string; source: string; target: string }>
): Map<string, { source: ProcessedSegment; target: ProcessedSegment }> {
  const map = new Map<string, { source: ProcessedSegment; target: ProcessedSegment }>();

  for (const unit of units) {
    map.set(unit.id, {
      source: processSegmentTags(unit.source),
      target: processSegmentTags(unit.target),
    });
  }

  return map;
}
