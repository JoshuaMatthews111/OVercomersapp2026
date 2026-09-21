#!/usr/bin/env python3
"""
Turn the owner's book PDF into the structured data the in-app reader shows.

    python3 assets/book/convert-gospel.py <gospel-of-salvation.pdf>

Writes:
    assets/book/gospel-of-salvation.json            the book, as chapters and blocks
    qa/fixtures/gospel-of-salvation.pdftotext.txt   the plain `pdftotext -layout`
                                                     output, whitespace-normalised,
                                                     which qa/book-fidelity.test.mjs
                                                     compares the JSON against

Needs poppler's `pdftotext` on PATH (Homebrew: /opt/homebrew/bin/pdftotext).

How the page is read
--------------------
`pdftotext -bbox-layout` gives every block and line with its box. The book's
typesetting is regular enough that the line HEIGHT and LEFT EDGE say what a line
is, so no word is ever guessed or rewritten:

    height 25.6               chapter title (one or two lines)
    height  9.9, centred      chapter label ("CHAPTER ONE") or the "• • •" rule
    height  9.9, left         scripture reference ("ROMANS 5:12")
    height 17.7               sub-heading
    height 14.0               "DEGREE AND DECLARE" heading (spelled as printed)
    height 12.2, indented     the declaration / prayer under it (italic callout)
    height 11.6, indented     scripture quotation (KJV — never altered)
    height 11.6, left         body paragraph; a taller gap between lines starts
                              a new paragraph

Line breaks inside a paragraph are joined with one space. A line that ends in a
hyphen is joined WITHOUT a space and the hyphen is kept: the only such break in
this book is "Spirit-given", a real compound word. Paragraphs that run across a
page break are joined back together. The "• • •" rules are dropped; the reader
draws its own chapter ending.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

NUMBER_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT',
                'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN']
LABEL_RE = re.compile(r'^(INTRODUCTION|CONCLUSION|SHARING GUIDE|CHAPTER (' + '|'.join(NUMBER_WORDS) + r'))$')
RIGHT_EDGE_FULL = 368.0   # a body line reaching this far was wrapped, not ended


def unescape(text):
    return (text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
            .replace('&quot;', '"').replace('&#39;', "'"))


def read_pages(pdf):
    html = subprocess.run(['pdftotext', '-bbox-layout', pdf, '-'], check=True,
                          capture_output=True, text=True).stdout
    pages = []
    for page in html.split('<page ')[1:]:
        width = float(re.search(r'width="([\d.]+)"', page).group(1))
        blocks = []
        for b in re.finditer(r'<block [^>]*>(.*?)</block>', page, re.S):
            lines = []
            for l in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', b.group(1), re.S):
                words = [unescape(w) for w in re.findall(r'<word [^>]*>([^<]*)</word>', l.group(5))]
                x0, y0, x1, y1 = (float(l.group(i)) for i in range(1, 5))
                lines.append({'x0': x0, 'y0': y0, 'x1': x1, 'h': round(y1 - y0, 1), 'text': ' '.join(words)})
            # The "• • •" chapter-end rule is sometimes set inside the block
            # above it; it is decoration, never text.
            lines = [l for l in lines if l['text'].replace('•', '').strip()]
            if lines:
                blocks.append(lines)
        pages.append({'width': width, 'blocks': blocks})
    return pages


def join_lines(texts):
    out = ''
    for t in texts:
        t = t.strip()
        if not out:
            out = t
        elif out.endswith('-'):
            out += t
        else:
            out += ' ' + t
    return out


def centred(line, width):
    mid = (line['x0'] + line['x1']) / 2
    return line['x0'] > 60 and abs(mid - width / 2) < 30


def classify(line, width):
    h, x = line['h'], line['x0']
    text = line['text'].strip()
    # "CHAPTER TWELVE" is set in body type in the PDF, unlike the other
    # labels, so a label is recognised by its words before its size.
    if LABEL_RE.match(text):
        return 'label'
    if h >= 25:
        return 'title'
    if 9.5 <= h <= 10.2:
        if text.replace('•', '').strip() == '':
            return 'rule'
        return 'ref'
    if 17 <= h <= 18.5:
        return 'h'
    if 13.5 <= h <= 14.5:
        return 'h-declare'
    if 12 <= h <= 12.5 and x > 52:
        return 'declaration'
    if 11.3 <= h <= 11.9:
        return 'scripture' if x > 52 else 'p'
    return 'other'


def split_paragraphs(lines):
    """Body lines are 10.3pt apart; a paragraph break adds about 4.5pt."""
    groups, current, last_y = [], [], None
    for line in lines:
        if last_y is not None and line['y0'] - last_y > 12.5:
            groups.append(current)
            current = []
        current.append(line)
        last_y = line['y0']
    if current:
        groups.append(current)
    return groups


def split_list(lines):
    items, current = [], []
    for line in lines:
        if re.match(r'^\d+\. ', line['text']) and current:
            items.append(current)
            current = []
        current.append(line)
    if current:
        items.append(current)
    out = []
    for item in items:
        text = join_lines([l['text'] for l in item])
        m = re.match(r'^(\d+)\. (.*?\.) (.*)$', text)
        out.append({'n': int(m.group(1)), 'text': m.group(2), 'ref': m.group(3)})
    return out


def convert(pdf):
    pages = read_pages(pdf)

    # Page 1 is the cover picture. Page 2 is the title page.
    title_page = [l for b in pages[1]['blocks'] for l in b]
    title = join_lines([l['text'] for l in title_page if l['h'] > 30])
    author_raw = next(l['text'] for l in title_page if 14.5 <= l['h'] <= 15.5)
    subtitle = join_lines([l['text'] for l in title_page if 12.6 <= l['h'] <= 13.0])
    note = join_lines([l['text'] for l in title_page if 10.3 <= l['h'] <= 10.7])

    # Page 3 is the Contents page.
    contents = []
    for b in pages[2]['blocks']:
        for l in b:
            m = re.match(r'^(INTRODUCTION|CONCLUSION|SHARING GUIDE|CHAPTER \d+) (.+)$', l['text'])
            if m:
                contents.append({'label': m.group(1), 'title': m.group(2)})

    chapters = []
    chapter = None
    pending_title = []

    def last_block():
        return chapter['blocks'][-1] if chapter and chapter['blocks'] else None

    for page_index, page in enumerate(pages[3:], start=4):
        width = page['width']
        first_on_page = True
        for block in page['blocks']:
            kind = classify(block[0], width)
            texts = [l['text'] for l in block]

            if kind == 'label':
                kicker = block[0]['text'].strip()
                n = len(chapters)
                chapter = {'id': '', 'kicker': kicker, 'label': '', 'title': '', 'blocks': []}
                chapters.append(chapter)
                pending_title = []
            elif kind == 'title':
                chapter['title'] = join_lines(([chapter['title']] if chapter['title'] else []) + texts)
            elif kind == 'rule':
                pass
            elif kind == 'ref':
                prev = last_block()
                ref = join_lines(texts)
                if prev and prev['type'] == 'scripture' and 'ref' not in prev:
                    prev['ref'] = ref
                else:
                    raise SystemExit(f'page {page_index}: reference with no quotation before it: {ref}')
            elif kind == 'h':
                chapter['blocks'].append({'type': 'h', 'text': join_lines(texts)})
            elif kind == 'h-declare':
                chapter['blocks'].append({'type': 'h', 'text': join_lines(texts), 'variant': 'declaration'})
            elif kind == 'declaration':
                prev = last_block()
                text = join_lines(texts)
                if first_on_page and prev and prev.get('variant') == 'declaration' and prev['type'] == 'p':
                    prev['text'] = join_lines([prev['text'], text])
                else:
                    chapter['blocks'].append({'type': 'p', 'variant': 'declaration', 'text': text})
            elif kind == 'scripture':
                prev = last_block()
                text = join_lines(texts)
                if first_on_page and prev and prev['type'] == 'scripture' and 'ref' not in prev and not prev['text'].endswith('”'):
                    prev['text'] = join_lines([prev['text'], text])
                elif not text.startswith('“'):
                    # Indented italic that is not a quotation: the Prayer of
                    # Salvation in the Sharing Guide. It is the author's
                    # words, not Scripture, so it must not be labelled KJV.
                    chapter['blocks'].append({'type': 'p', 'variant': 'prayer', 'text': text})
                else:
                    chapter['blocks'].append({'type': 'scripture', 'text': text})
            elif kind == 'p':
                if re.match(r'^\d+\. ', block[0]['text']):
                    chapter['blocks'].append({'type': 'list', 'items': split_list(block)})
                    chapter['blocks'][-1]['text'] = '\n'.join(f"{i['n']}. {i['text']} {i['ref']}" for i in chapter['blocks'][-1]['items'])
                    first_on_page = False
                    continue
                groups = split_paragraphs(block)
                for gi, group in enumerate(groups):
                    text = join_lines([l['text'] for l in group])
                    prev = last_block()
                    continues = (
                        first_on_page and gi == 0 and prev is not None and prev['type'] == 'p'
                        and 'variant' not in prev and prev.get('_open', False)
                    )
                    if continues:
                        prev['text'] = join_lines([prev['text'], text])
                    else:
                        chapter['blocks'].append({'type': 'p', 'text': text})
                    last_line = group[-1]
                    chapter['blocks'][-1]['_open'] = (
                        last_line['x1'] >= RIGHT_EDGE_FULL
                        or not re.search(r'[.?!:”"’)]$', last_line['text'].strip())
                    )
            else:
                raise SystemExit(f'page {page_index}: unclassified line {block[0]}')
            first_on_page = False

    for i, ch in enumerate(chapters):
        k = ch['kicker']
        if k.startswith('CHAPTER '):
            num = NUMBER_WORDS.index(k.split(' ', 1)[1]) + 1
            ch['id'] = f'chapter-{num}'
            ch['label'] = f'Chapter {num}'
        else:
            ch['id'] = k.lower().replace(' ', '-')
            ch['label'] = k.title()
        for b in ch['blocks']:
            b.pop('_open', None)
        ch['blocks'] = [dict(sorted(b.items(), key=lambda kv: ['type', 'variant', 'text', 'ref', 'items'].index(kv[0]))) for b in ch['blocks']]

    book = {
        'id': 'gospel-of-salvation',
        'title': title,
        'author': author_raw.title(),
        'authorAsPrinted': author_raw,
        'subtitle': subtitle,
        'note': note,
        'source': 'The Gospel of Salvation, 22-page 6x9in PDF, converted by assets/book/convert-gospel.py',
        'contents': contents,
        'chapters': [{'id': c['id'], 'label': c['label'], 'kicker': c['kicker'], 'title': c['title'], 'blocks': c['blocks']} for c in chapters],
    }
    return book


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pdf = sys.argv[1]
    book = convert(pdf)
    with open(os.path.join(HERE, 'gospel-of-salvation.json'), 'w', encoding='utf-8') as f:
        json.dump(book, f, ensure_ascii=False, indent=1)
        f.write('\n')
    raw = subprocess.run(['pdftotext', '-layout', pdf, '-'], check=True, capture_output=True, text=True).stdout
    normalised = ' '.join(raw.split())
    fixture = os.path.join(ROOT, 'qa', 'fixtures', 'gospel-of-salvation.pdftotext.txt')
    os.makedirs(os.path.dirname(fixture), exist_ok=True)
    with open(fixture, 'w', encoding='utf-8') as f:
        f.write(normalised + '\n')
    words = sum(len(b.get('text', '').split()) for c in book['chapters'] for b in c['blocks'])
    print(f"{len(book['chapters'])} chapters, {sum(len(c['blocks']) for c in book['chapters'])} blocks, {words} words in blocks")


if __name__ == '__main__':
    main()
