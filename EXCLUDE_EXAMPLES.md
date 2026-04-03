# Exclude Pattern Examples

## Problem: Tusentallsseparator vs Årstall

**Scenario:** Du vil endre norsk tusentallsseparator fra `1000` til `1 000` (med nbsp), men **IKKE** endre årstall som 2024, 1995, etc.

### Løsning 1: Bruk `--exclude` Parameter ✅ (Beste)

```bash
# Finn alle 4-sifrede tall, men EKSKLUDER årstall (1900-2099)
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "^(19|20)\d{2}$"

# Replace med nbsp, men ekskluder årstall
python src/cli.py replace input.xliff "\b(\d{1})(\d{3})\b" "$1 $2" --exclude "^(19|20)\d{2}$"
```

**Hva skjer:**
- `\b\d{4}\b` matcher alle 4-sifrede tall
- `--exclude "^(19|20)\d{2}$"` hopper over tall som matcher årstall (1900-2099)
- Result: `1000` → `1 000`, men `2024` forblir `2024`

### Løsning 2: Negative Lookahead (Avansert Regex)

```bash
# Finn 4-sifrede tall som IKKE er årstall
python src/cli.py find input.xliff "\b(?!19\d{2}\b)(?!20\d{2}\b)\d{4}\b"

# Med replacement:
python src/cli.py replace input.xliff "\b(?!19\d{2}|20\d{2})(\d{1})(\d{3})\b" "$1 $2"
```

**Forklaring:**
- `(?!19\d{2}\b)` = Negative lookahead - "ikke hvis det starter med 19xx"
- `(?!20\d{2}\b)` = "ikke hvis det starter med 20xx"
- `\d{4}` = matcher 4 sifre

### Løsning 3: Context-Aware Pattern (Smartest!)

```bash
# Finn tall som kommer etter ord som "kr", "NOK", "$", etc.
python src/cli.py find input.xliff "(?:kr|NOK|\$|USD|EUR|€)\s*(\d{1,3})\s*(\d{3})"

# Replace med nbsp:
python src/cli.py replace input.xliff "(kr|NOK)\s*(\d{1})(\d{3})" "$1 $2 $3"
```

**Fordel:** Du matcher kun tall i økonomisk kontekst, så du unngår automatisk årstall!

## Flere Eksempler

### Eksempel 1: Telefonnummer vs Postnummer

**Problem:** Norske telefonnummer (8 sifre) vs postnummer (4 sifre)

```bash
# Finn telefonnummer, men IKKE postnummer
python src/cli.py find input.xliff "\b\d{4}\s?\d{2}\s?\d{2}\b" --exclude "^\d{4}$"

# Eller bruk context:
python src/cli.py find input.xliff "(?:tlf|phone|mobil):\s*(\d{3})\s?(\d{2})\s?(\d{3})"
```

### Eksempel 2: Priser vs Produktnummer

**Problem:** `1.999` som pris vs `1.999` som produktnummer

```bash
# Finn priser (har kr/$ før eller etter)
python src/cli.py find input.xliff "(kr|\$)\s*(\d{1,3})[.,](\d{3})"

# Ekskluder hvis det har bokstaver før (produktnummer)
python src/cli.py find input.xliff "\b\d{1,3}[.,]\d{3}\b" --exclude "^[A-Z]"
```

### Eksempel 3: E-post vs URL

**Problem:** Finn e-post, men ikke URLs som inneholder @

```bash
# Finn e-post
python src/cli.py find input.xliff "\b[\w.-]+@[\w.-]+\.\w{2,}\b"

# Ekskluder URLs (har http://)
python src/cli.py find input.xliff "@[\w.-]+" --exclude "^https?://"
```

## Built-in Patterns med Exclude-Support

Du kan også legge til exclude til existing patterns:

```bash
# Bruk "Multiple spaces" pattern, men ekskluder HTML
python src/cli.py patterns apply --name "Multiple spaces" --file input.xliff --exclude "<[^>]+>"

# Custom pattern med exclude
python src/cli.py patterns add \
  --name "Norwegian thousand separator" \
  --pattern "\b(\d{1})(\d{3})\b" \
  --replacement "$1 $2" \
  --description "Add nbsp to numbers, excluding years" \
  --category "Norwegian"

# Bruk med exclude:
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "^(19|20)\d{2}$" --save
```

## Tips for å Skrive Exclude Patterns

1. **Test exclude-pattern først:**
   ```bash
   # Test hva som matches exclude-pattern
   python src/cli.py find input.xliff "^(19|20)\d{2}$"
   ```

2. **Bruk anchors (^ og $):**
   - `^` = start av match
   - `$` = slutt av match
   - `^(19|20)\d{2}$` matcher KUN årstall, ikke andre tall

3. **Combiner flere excludes med |:**
   ```bash
   --exclude "^19\d{2}$|^20\d{2}$|^USD$|^EUR$"
   ```

4. **Case-insensitive exclude:**
   ```bash
   # Exclude virker med --case-sensitive flagget
   python src/cli.py find input.xliff "\btest\b" --exclude "^TEST$" --case-sensitive
   ```

## Praktiske Brukstilfeller

### 1. Norsk Lokalisering: Tusentallsseparator

```bash
# Step 1: Test hva som matches
python src/cli.py find input.xliff "\b\d{4}\b"

# Step 2: Test exclude (finn kun årstall)
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "^[^12]"  # kun tall som IKKE starter med 1 eller 2

# Step 3: Apply med exclude
python src/cli.py replace input.xliff "\b(\d{1})(\d{3})\b" "$1 $2" --exclude "^(19|20)\d{2}$" --save
# Lagre som: "Norwegian thousand separator (exclude years)"
```

### 2. Valuta-konvertering

```bash
# Endre "USD 1,000" til "USD 1 000" men behold årstall
python src/cli.py replace input.xliff "(USD|EUR|NOK)\s*(\d{1,3}),(\d{3})" "$1 $2 $3"
```

### 3. Dato-format med unntak

```bash
# Endre DD/MM/YYYY til DD.MM.YYYY, men hopp over hvis det er en URL
python src/cli.py replace input.xliff "(\d{2})/(\d{2})/(\d{4})" "$1.$2.$3" --exclude "https?://"
```

## Feilsøking

### Problem: "Exclude virker ikke"

**Sjekk:**
1. Exclude-pattern matcher hele den matchede teksten, ikke hele linjen
2. Bruk `^` og `$` for å matche start og slutt av match
3. Test exclude-pattern separat

```bash
# Feil: Dette ekskluderer ingenting
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "2024"

# Riktig: Match hele tallet
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "^2024$"
```

### Problem: "Får ikke med alle tall jeg vil ha"

**Løsning:** Bruk context-aware pattern istedenfor exclude:

```bash
# Istedenfor å ekskludere, søk kun der du VIL ha matches
python src/cli.py find input.xliff "(?:pris|cost|kr|NOK).*?(\d{1,3})\s*(\d{3})"
```

## Kombinere Exclude med Andre Features

```bash
# Exclude + Save + Case-sensitive
python src/cli.py find input.xliff "\btest\b" \
  --exclude "^TEST$" \
  --case-sensitive \
  --save

# Exclude + Max replacements
python src/cli.py replace input.xliff "\d{4}" "XXXX" \
  --exclude "^(19|20)\d{2}$" \
  --max-replacements 5

# Exclude + Output til ny fil
python src/cli.py replace input.xliff "\b(\d)(\d{3})\b" "$1 $2" \
  --exclude "^(19|20)\d{2}$" \
  --output output.xliff
```

## Pattern Library med Exclude

Når du lagrer patterns med `--save`, kan du ikke lagre exclude-pattern direkte, men du kan dokumentere det i description:

```bash
python src/cli.py replace input.xliff "\b(\d)(\d{3})\b" "$1 $2" \
  --exclude "^(19|20)\d{2}$" \
  --save

# I dialogen:
# Name: Norwegian thousand separator
# Description: Add nbsp to 4-digit numbers. Use with --exclude "^(19|20)\d{2}$" to skip years
# Category: Norwegian

# Senere bruk:
python src/cli.py find input.xliff "\b\d{4}\b" --exclude "^(19|20)\d{2}$"
```

## Konklusjon

**Best Practice:**
1. ✅ Bruk `--exclude` for enkle case (årstall, spesifikke ord)
2. ✅ Bruk context-aware patterns når mulig (smartest!)
3. ✅ Test alltid med `find` før `replace`
4. ✅ Kombiner med `--save` for å gjenbruke

**Når du skal lage GUI:**
- Exclude-field ved siden av find/replace
- Dropdown med vanlige excludes ("Years 1900-2099", "URLs", "Email addresses")
- Preview viser hva som matches OG hva som excludes
