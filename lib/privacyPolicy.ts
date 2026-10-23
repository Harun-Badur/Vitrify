export type PolicyBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

export const policyPlainText = (text: string): string =>
  text.replace(/\*\*|`/g, '');

// The bundled document is trusted first-party text. No HTML/WebView or remote
// script execution; table rows become vertical records on small screens.
export function parsePolicyBlocks(markdown: string): PolicyBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: PolicyBlock[] = [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => policyPlainText(cell.trim()));
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line || /^---+$/.test(line)) {
      index++;
      continue;
    }
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        text: policyPlainText(heading[2]),
      });
      index++;
      continue;
    }
    if (line.startsWith('|')) {
      const headers = cells(line),
        rows: string[][] = [];
      index++;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        if (!/^\|[\s:|\-]+\|$/.test(lines[index].trim()))
          rows.push(cells(lines[index]));
        index++;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3} |\||---+$|\d+\. |[-•] )/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push({
      kind: 'paragraph',
      text: policyPlainText(paragraph.join(' ')),
    });
  }
  return blocks;
}
