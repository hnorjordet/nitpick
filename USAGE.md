# XLIFF Regex Tool - Brukerveiledning

## Hurtigstart

1. **Installer og aktiver virtuelt miljø:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Test verktøyet med sample-filen:**
   ```bash
   python src/cli.py stats samples/sample.xliff
   ```

## Vanlige brukstilfeller

### 1. Finn og erstatt tekst

**Problem:** Du har oversatt "e-post" som "e-post" og "epost" i samme prosjekt, og vil standardisere til "e-post"

```bash
python src/cli.py find input.xliff "\bepost\b"
python src/cli.py replace input.xliff "\bepost\b" "e-post"
```

### 2. Normaliser mellomrom

**Problem:** Noen segmenter har flere mellomrom etter hverandre

```bash
python src/cli.py find input.xliff "\s{2,}"
python src/cli.py replace input.xliff "\s{2,}" " "
```

### 3. Rett skrivefeil

**Problem:** Du har konsekvent skrevet "teh" istedenfor "the"

```bash
python src/cli.py replace input.xliff "\bteh\b" "the"
```

### 4. Konverter datoformat

**Problem:** Norske datoer skal være DD.MM.YYYY, ikke MM/DD/YYYY

```bash
# Finn amerikanske datoer
python src/cli.py find input.xliff "(\d{1,2})/(\d{1,2})/(\d{4})"

# Konverter til norsk format
python src/cli.py replace input.xliff "(\d{1,2})/(\d{1,2})/(\d{4})" "\\2.\\1.\\3"
```

### 5. Oppdater e-postadresser

**Problem:** Firmaets domene har endret seg fra @oldcompany.com til @newcompany.com

```bash
python src/cli.py replace input.xliff "@oldcompany\.com" "@newcompany.com"
```

### 6. Fjern unødvendige tegn

**Problem:** Noen segmenter har doble punktum (..)

```bash
python src/cli.py replace input.xliff "\.\." "."
```

### 7. Preview før endring

**Problem:** Du vil se hva som matches før du gjør endringer

```bash
# Først find for å se matches
python src/cli.py find input.xliff "pattern"

# Deretter replace til ny fil for å sjekke
python src/cli.py replace input.xliff "pattern" "replacement" --output preview.xliff

# Sjekk preview.xliff, hvis ok:
python src/cli.py replace input.xliff "pattern" "replacement"
```

## Regex-tips

### Vanlige patterns

- **E-post:** `\w+@\w+\.\w+`
- **URL:** `https?://[^\s]+`
- **Telefonnummer (norsk):** `\+?47\s?\d{8}`
- **Flere mellomrom:** `\s{2,}`
- **Start av ord:** `\b\w+`
- **Slutt av ord:** `\w+\b`
- **Tall:** `\d+`
- **Dato (DD.MM.YYYY):** `\d{2}\.\d{2}\.\d{4}`

### Backreferences

Bruk parenteser for å capture grupper, og referer til dem med `\1`, `\2`, etc:

```bash
# Bytt rekkefølge på fornavn/etternavn
python src/cli.py replace input.xliff "(\w+) (\w+)" "\\2, \\1"

# Konverter e-post format
python src/cli.py replace input.xliff "(\w+)@(\w+)\.com" "\\1 at \\2 dot com"
```

## Sikkerhet

- Verktøyet lager **automatisk backup** før alle endringer
- Backups lagres i `.backups/` mappen ved siden av original-filen
- Bruk `--output` for å lagre til ny fil uten å endre originalen
- Bruk `--no-backup` kun hvis du er 100% sikker

## Backup management

```bash
# Se alle backups for en fil
python src/cli.py backup list input.xliff

# Gjenopprett en backup
python src/cli.py backup restore input.xliff --backup .backups/input_20231224_120000.xliff

# Rydd opp gamle backups (behold kun de 5 nyeste)
python src/cli.py backup cleanup input.xliff --keep 5
```

## Feilsøking

### "Invalid regex pattern"

- Sjekk at spesialtegn er escaped: `\.` `\*` `\?` `\+` `\[` `\]`
- Test regex-en på https://regex101.com først

### "Failed to parse XLIFF file"

- Sjekk at filen er en gyldig XLIFF-fil
- Prøv å åpne filen i en teksteditor og se etter XML-feil

### Tags forsvinner etter replace

- Dette skal ikke skje - verktøyet bevarer tags
- Hvis det skjer, rapporter som bug og bruk backup

## Tips

1. Test alltid med `find` før `replace`
2. Bruk `--output` for å teste på en kopi først
3. Lag backups ofte med `backup list`
4. Bruk Xbench checklist-filer for å importere patterns du bruker ofte
