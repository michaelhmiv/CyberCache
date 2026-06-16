import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type ButtonFinding = {
  file: string;
  line: number;
  tag: string;
  snippet: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.tsx$/.test(entry.name) ? [fullPath] : [];
  });
}

function attrName(attr: ts.JsxAttributeLike): string | undefined {
  return ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name) ? attr.name.text : undefined;
}

function hasAttr(attrs: ts.NodeArray<ts.JsxAttributeLike>, name: string): boolean {
  return attrs.some((attr) => attrName(attr) === name);
}

function literalAttrValue(attrs: ts.NodeArray<ts.JsxAttributeLike>, name: string): string | null {
  const attr = attrs.find((candidate) => attrName(candidate) === name);
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  return null;
}

function isInteractiveButton(tag: string): boolean {
  return tag === 'button' || tag === 'motion.button';
}

function findDeadButtons(): ButtonFinding[] {
  const findings: ButtonFinding[] = [];

  for (const file of walk(ROOT)) {
    if (file.includes(`${path.sep}test${path.sep}`)) continue;
    const sourceText = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (isInteractiveButton(tag)) {
          const attrs = node.attributes.properties;
          const buttonType = literalAttrValue(attrs, 'type');
          const isSubmit = buttonType === 'submit';
          const isIntentionallyDisabled = hasAttr(attrs, 'disabled') || hasAttr(attrs, 'aria-disabled');
          const hasActivationHandler = hasAttr(attrs, 'onClick') || hasAttr(attrs, 'onPointerUp') || hasAttr(attrs, 'onMouseUp');

          if (!isSubmit && !isIntentionallyDisabled && !hasActivationHandler) {
            const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
            findings.push({
              file: path.relative(process.cwd(), file),
              line: pos.line + 1,
              tag,
              snippet: node.getText(source).replace(/\s+/g, ' ').slice(0, 180),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return findings;
}

describe('button wiring audit', () => {
  it('does not render enabled buttons without an activation handler', () => {
    expect(findDeadButtons()).toEqual([]);
  });
});
