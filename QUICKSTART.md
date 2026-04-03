# XLIFF Regex Tool - Quickstart Guide

## 🚀 Kom i gang på 2 minutter

### 1. Installer

```bash
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Test med sample-fil

```bash
# Vis statistikk
python src/cli.py stats samples/sample.xliff

# Søk etter e-postadresser
python src/cli.py find samples/sample.xliff "@\w+\.\w+"

# Normaliser mellomrom
python src/cli.py replace samples/sample.xliff "\s{2,}" " " --output test.xliff
```

## 💡 Smart workflow: Lagre dine beste søk!

### Scenario: Du finner et genialt regex-søk

```bash
# Søk etter norske telefonnummer
python src/cli.py find input.xliff "\d{3}\s?\d{2}\s?\d{3}" --save
```

Når du bruker `--save` flagget, får du mulighet til å lagre søket til biblioteket:

```
Total matches found: 15

────────────────────────────────────────────────────────────
Save this search to pattern library?
Pattern name (or press Enter to skip): Norwegian phone numbers
Description (optional): Find Norwegian phone numbers in format XXX XX XXX
Category (default: Custom): Norwegian
✓ Pattern 'Norwegian phone numbers' saved to library!
```

### Nå kan du gjenbruke det når som helst!

```bash
# List alle dine lagrede patterns
python src/cli.py patterns list --category "Norwegian"

# Bruk det på en ny fil
python src/cli.py patterns apply --name "Norwegian phone numbers" --file other.xliff

# Søk i biblioteket
python src/cli.py patterns search --query "phone"
```

## 📚 Innebygde patterns

Verktøyet kommer med 23 innebygde patterns:

```bash
# Se alle
python src/cli.py patterns list

# Se kun aktive
python src/cli.py patterns list --enabled

# Se kategorier
python src/cli.py patterns categories
```

### Populære built-in patterns:

```bash
# Normaliser flere mellomrom
python src/cli.py patterns apply --name "Multiple spaces" --file input.xliff

# Fjern doble punktum
python src/cli.py patterns apply --name "Double periods" --file input.xliff

# Finn e-postadresser
python src/cli.py patterns apply --name "Find email addresses" --file input.xliff
```

## 🎯 Vanlige brukstilfeller

### 1. Fikse konsistente skrivefeil

```bash
# Test først
python src/cli.py find input.xliff "\bemail\b"

# Hvis det ser bra ut, erstatt og lagre
python src/cli.py replace input.xliff "\bemail\b" "e-mail" --save
```

### 2. Konverter datoformat

```bash
# MM/DD/YYYY til DD.MM.YYYY
python src/cli.py replace input.xliff "(\d{1,2})/(\d{1,2})/(\d{4})" "\2.\1.\3" --save
```

### 3. QA-sjekk: Finn ubalanserte parenteser

```bash
python src/cli.py patterns apply --name "Unmatched parentheses" --file input.xliff
```

## 📖 Nyttige kommandoer

```bash
# Vis XLIFF statistikk
python src/cli.py stats FILE

# Søk med regex
python src/cli.py find FILE "pattern"
python src/cli.py find FILE "pattern" --save          # Lagre hvis bra
python src/cli.py find FILE "pattern" --case-sensitive

# Erstatt med regex
python src/cli.py replace FILE "old" "new"
python src/cli.py replace FILE "old" "new" --save     # Lagre hvis bra
python src/cli.py replace FILE "old" "new" --output NEW_FILE

# Pattern library
python src/cli.py patterns list                        # List alle
python src/cli.py patterns search --query "WORD"       # Søk
python src/cli.py patterns show --name "NAME"          # Vis detaljer
python src/cli.py patterns apply --name "NAME" --file FILE

# Backups
python src/cli.py backup list FILE
python src/cli.py backup restore FILE --backup BACKUP_FILE
python src/cli.py backup cleanup FILE --keep 5
```

## 💾 Hvor lagres custom patterns?

Custom patterns lagres i:
```
~/.xliff_regex_tool/patterns.json
```

Dette gjør at patterns er tilgjengelige på tvers av alle prosjekter!

## 🔥 Pro tips

1. **Bruk --save alltid** når du finner et godt søk
2. **Test med find først**, deretter replace
3. **Bruk --output** for å teste på en kopi
4. **Søk i biblioteket** før du lager eget pattern
5. **Tagger** gjør det lett å finne igjen patterns senere

## 🆘 Hjelp

```bash
python src/cli.py --help
python src/cli.py find --help
python src/cli.py replace --help
python src/cli.py patterns --help
```

## 📝 Eksempel-sesjon

```bash
# Aktiver miljø
source venv/bin/activate

# Analyser fil
python src/cli.py stats input.xliff

# Finn doble mellomrom
python src/cli.py find input.xliff "\s{2,}"
# Output viser 47 matches

# Fikse det og lagre pattern
python src/cli.py replace input.xliff "\s{2,}" " " --save
# Lagre som: "Normalize spaces" i kategori "Cleanup"

# Bruk på andre filer
python src/cli.py patterns apply --name "Normalize spaces" --file file2.xliff
python src/cli.py patterns apply --name "Normalize spaces" --file file3.xliff

# Se alle dine custom patterns
python src/cli.py patterns list --category "Cleanup"
```

---

**Neste steg:** Les [PATTERNS.md](PATTERNS.md) for full oversikt over alle innebygde patterns!
