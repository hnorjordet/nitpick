# Pattern Library Guide

XLIFF Regex Tool kommer med et innebygd bibliotek av vanlige regex-mønstre inspirert av QA-verktøy som Xbench, Verifika og ApSIC.

## Hurtigstart

```bash
# Se alle patterns
python src/cli.py patterns list

# Søk etter patterns
python src/cli.py patterns search --query "space"

# Bruk et pattern
python src/cli.py patterns apply --name "Multiple spaces" --file input.xliff
```

## Innebygde Patterns

### Whitespace (5 patterns)

**Multiple spaces** ✓
- Pattern: `\s{2,}`
- Replacement: ` ` (single space)
- Normaliser flere mellomrom til ett
- Tags: whitespace, formatting, common

**Leading spaces** ✓
- Pattern: `^\s+`
- Replacement: (tom)
- Fjern mellomrom i starten av segment
- Tags: whitespace, formatting

**Trailing spaces** ✓
- Pattern: `\s+$`
- Replacement: (tom)
- Fjern mellomrom på slutten av segment
- Tags: whitespace, formatting

**Space before punctuation** ✓
- Pattern: `\s+([.,!?;:])`
- Replacement: `\1`
- Fjern mellomrom før punktum/komma/etc
- Tags: whitespace, punctuation

**No space after punctuation** ✓
- Pattern: `([.,!?;:])([A-ZÆØÅ])`
- Replacement: `\1 \2`
- Legg til mellomrom etter punktum før stor bokstav
- Tags: whitespace, punctuation

### Punctuation (3 patterns)

**Double periods** ✓
- Pattern: `\.\.`
- Replacement: `.`
- Erstatt doble punktum med ett
- Tags: punctuation, typo

**Double commas** ✓
- Pattern: `,,`
- Replacement: `,`
- Erstatt doble komma med ett
- Tags: punctuation, typo

**Space before comma** ✓
- Pattern: `\s+,`
- Replacement: `,`
- Fjern mellomrom før komma
- Tags: punctuation, formatting

### Typos (3 patterns)

**'teh' typo** ✓
- Pattern: `\bteh\b`
- Replacement: `the`
- Vanlig skrivefeil
- Tags: typo, english

**'recieve' typo** ✓
- Pattern: `\brecieve\b`
- Replacement: `receive`
- Vanlig skrivefeil
- Tags: typo, english

**'occured' typo** ✓
- Pattern: `\boccured\b`
- Replacement: `occurred`
- Vanlig skrivefeil
- Tags: typo, english

### Norwegian (4 patterns)

Disse er **disabled** by default - aktiver ved behov.

**Norwegian quotes** ○
- Pattern: `"([^"]+)"`
- Replacement: `«\1»`
- Konverter engelske sitattegn til norske gåseøyne
- Tags: norwegian, quotes, localization

**Date format US to NO** ○
- Pattern: `(\d{1,2})/(\d{1,2})/(\d{4})`
- Replacement: `\2.\1.\3`
- Konverter MM/DD/YYYY til DD.MM.YYYY
- Tags: norwegian, date, localization

**'å' vs 'aa'** ○
- Pattern: `\baa\b`
- Replacement: `å`
- Erstatt 'aa' med 'å'
- Tags: norwegian, typo

**Norwegian double negation** ○
- Pattern: `\bikke\s+ingen\b`
- Replacement: `ingen`
- Fiks dobbel negasjon
- Tags: norwegian, grammar

### URLs & Emails (2 patterns)

**Find email addresses** ✓
- Pattern: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`
- Kun søk (ingen replacement)
- Tags: email, search-only

**Find HTTP URLs** ✓
- Pattern: `https?://[^\s<>\"]+`
- Kun søk (ingen replacement)
- Tags: url, search-only

### Tags & Markup (2 patterns)

**Unmatched brackets** ✓
- Pattern: `\[[^\]]*$|^[^\[]*\]`
- Finn segmenter med ubalanserte klammeparenteser
- Tags: tags, qa, search-only

**Unmatched parentheses** ✓
- Pattern: `\([^\)]*$|^[^\(]*\)`
- Finn segmenter med ubalanserte parenteser
- Tags: tags, qa, search-only

### Numbers (2 patterns)

**Space in large numbers** ○
- Pattern: `(\d)(\d{3})\b`
- Replacement: `\1 \2`
- Legg til mellomrom som tusenskilletegn (norsk standard)
- Tags: numbers, norwegian, formatting

**Comma to period in decimals** ○
- Pattern: `(\d),(\d)`
- Replacement: `\1.\2`
- Konverter komma til punktum i desimaltall
- Tags: numbers, localization

### Consistency (2 patterns)

**Inconsistent capitalization of 'internet'** ○
- Pattern: `\binternet\b`
- Replacement: `Internet`
- Stor forbokstav i Internet (hvis stilguide krever det)
- Tags: consistency, capitalization

**Inconsistent capitalization of 'e-mail'** ○
- Pattern: `\bemail\b`
- Replacement: `e-mail`
- Endre 'email' til 'e-mail'
- Tags: consistency, norwegian

## Egne Patterns

### Legg til eget pattern

```bash
python src/cli.py patterns add \
  --name "Mitt pattern" \
  --pattern "regex_her" \
  --replacement "erstatning" \
  --description "Hva det gjør" \
  --category "Custom" \
  --tag "mytag"
```

### Eksempel: Norsk telefonnummer

```bash
python src/cli.py patterns add \
  --name "Norwegian phone format" \
  --pattern "(\d{3})\s?(\d{2})\s?(\d{3})" \
  --replacement "\1 \2 \3" \
  --description "Format Norwegian phone numbers with spaces" \
  --category "Norwegian" \
  --tag "phone" \
  --tag "formatting"
```

### Eksempel: Fjern HTML tags

```bash
python src/cli.py patterns add \
  --name "Remove HTML tags" \
  --pattern "<[^>]+>" \
  --replacement "" \
  --description "Remove all HTML tags from text" \
  --category "Cleanup" \
  --tag "html" \
  --tag "cleanup"
```

## Tips

1. **Test først**: Bruk `find` kommando for å se matches før du bruker `replace`
   ```bash
   python src/cli.py find input.xliff "\s{2,}"
   ```

2. **Søk i biblioteket**: Før du lager eget pattern, søk om det allerede finnes
   ```bash
   python src/cli.py patterns search --query "space"
   ```

3. **Filtrer på kategori**: Se kun patterns i en kategori
   ```bash
   python src/cli.py patterns list --category "Norwegian"
   ```

4. **Aktive patterns**: Se kun de som er enabled
   ```bash
   python src/cli.py patterns list --enabled
   ```

5. **Lagre favoritter**: Custom patterns lagres i `~/.xliff_regex_tool/patterns.json`

## Pattern Syntax

Verktøyet bruker Python's `regex` bibliotek som støtter:

- **Basic**: `.` `*` `+` `?` `^` `$`
- **Character classes**: `[abc]` `[^abc]` `\d` `\w` `\s`
- **Groups**: `(pattern)` `(?:pattern)`
- **Backreferences**: `\1` `\2` etc
- **Lookahead/behind**: `(?=pattern)` `(?!pattern)`
- **Unicode**: Full Unicode support

Se https://docs.python.org/3/library/re.html for full dokumentasjon.
