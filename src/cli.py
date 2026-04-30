#!/usr/bin/env python3
"""
Command-line interface for XLIFF Regex Tool.
Provides testing interface for the backend functionality.
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from parsers.xliff_parser import XLIFFParser
from parsers.tmx_parser import TMXParser
from parsers.segment_adapter import trans_units_to_segments
from parsers.termlist_parser import load_termlist, load_checklist
from regex_engine.regex_processor import RegexProcessor
from backup.backup_manager import BackupManager
from patterns.pattern_library import PatternLibrary, Pattern
from validators.icu_validator import ICUValidator
from qa.qa_profile import QAProfileManager, QAProfile
from spellcheck.spell_engine import (
    load_all_dictionaries, build_exclusion_set, run_spellcheck, get_suggestions,
)
from spellcheck.dic_manager import list_dics, add_word
from terminology.term_checker import check_segments
from qachecks.number_checker import check_numbers
from qachecks.qa_checker import run_qa_checks, ALL_QA_CHECKS
from settings.settings_manager import load as load_settings_obj, save as save_settings_obj, Settings
from merging.xliff_merger import scan_folder, merge_xliff_files, suggest_output_name
from reporting.report_generator import generate_xlsx_report
from parsers.docx_parser import parse_phrase_docx, DocxSegment
import json
from dataclasses import asdict


def get_parser(file_path: str, target_lang: str = None):
    """Return the appropriate parser based on file extension."""
    if file_path.lower().endswith('.tmx'):
        return TMXParser(file_path, target_lang=target_lang)
    return XLIFFParser(file_path)


def tmx_languages_command(args):
    """Return available languages in a TMX file as JSON."""
    parser = TMXParser(args.file)
    if not parser.parse():
        print(json.dumps({"error": "Failed to parse TMX file"}))
        return 1
    output = {
        "srclang": parser.srclang,
        "languages": parser.get_available_languages()
    }
    print(json.dumps(output))
    return 0


def find_command(args):
    """Execute find operation."""
    print(f"Searching in: {args.file}")
    print(f"Pattern: {args.pattern}")
    print()

    # Parse XLIFF
    parser = XLIFFParser(args.file)
    if not parser.parse():
        print("Failed to parse XLIFF file")
        return 1

    # Create regex processor
    regex_proc = RegexProcessor()

    # Validate pattern
    is_valid, error = regex_proc.validate_pattern(args.pattern)
    if not is_valid:
        print(f"Invalid regex pattern: {error}")
        return 1

    # Search in translation units
    matches_found = 0
    flags = 0 if args.case_sensitive else regex_proc.regex_module.IGNORECASE

    for tu in parser.get_trans_units():
        # Search in target
        if args.target or (not args.source and not args.target):
            target_text = tu.get_target_text()
            if target_text:
                exclude = getattr(args, 'exclude', None)
                matches = regex_proc.find_in_text(
                    target_text, args.pattern, flags=flags, ignore_tags=not args.include_tags,
                    exclude_pattern=exclude
                )

                if matches:
                    print(f"[TU: {tu.id}] TARGET:")
                    print(f"  {target_text}")
                    for start, end, matched in matches:
                        print(f"  → Match: '{matched}' (pos {start}-{end})")
                        matches_found += 1
                    print()

        # Search in source
        if args.source:
            source_text = tu.get_source_text()
            exclude = getattr(args, 'exclude', None)
            matches = regex_proc.find_in_text(
                source_text, args.pattern, flags=flags, ignore_tags=not args.include_tags,
                exclude_pattern=exclude
            )

            if matches:
                print(f"[TU: {tu.id}] SOURCE:")
                print(f"  {source_text}")
                for start, end, matched in matches:
                    print(f"  → Match: '{matched}' (pos {start}-{end})")
                    matches_found += 1
                print()

    print(f"\nTotal matches found: {matches_found}")

    # Offer to save pattern if matches found and --save flag is set
    if matches_found > 0 and hasattr(args, 'save') and args.save:
        print("\n" + "─" * 60)
        print("Save this search to pattern library?")
        name = input("Pattern name (or press Enter to skip): ").strip()

        if name:
            library = PatternLibrary()
            library.load_custom_patterns()

            description = input("Description (optional): ").strip()
            category = input("Category (default: Custom): ").strip() or "Custom"

            new_pattern = Pattern(
                name=name,
                pattern=args.pattern,
                replacement="",
                description=description,
                category=category,
                case_sensitive=args.case_sensitive,
                enabled=True,
                tags=["saved-from-find", "search-only"]
            )

            if library.add_pattern(new_pattern):
                if library.save_custom_patterns():
                    print(f"✓ Pattern '{name}' saved to library!")
                else:
                    print("✗ Failed to save pattern")
            else:
                print("✗ Pattern with that name already exists")

    return 0


def batch_find_command(args):
    """Execute batch find operation using a QA profile."""
    if args.json:
        # JSON output mode for GUI integration
        try:
            # Load QA profile
            profile = QAProfileManager.load_from_xml(args.profile)

            # Parse XLIFF
            parser = XLIFFParser(args.file)
            if not parser.parse():
                print(json.dumps({"error": "Failed to parse XLIFF file"}))
                return 1

            # Create regex processor
            regex_proc = RegexProcessor()

            # Get enabled checks from profile
            enabled_checks = QAProfileManager.get_enabled_checks(profile)

            # Collect all matches
            all_results = []

            for check in enabled_checks:
                # Validate pattern
                is_valid, error = regex_proc.validate_pattern(check.pattern)
                if not is_valid:
                    continue  # Skip invalid patterns

                flags = 0 if check.case_sensitive else regex_proc.regex_module.IGNORECASE

                for tu in parser.get_trans_units():
                    # Search in target (default)
                    target_text = tu.get_target_text()
                    if target_text:
                        matches = regex_proc.find_in_text(
                            target_text,
                            check.pattern,
                            flags=flags,
                            ignore_tags=True,
                            exclude_pattern=check.exclude_pattern
                        )

                        for start, end, matched in matches:
                            # Calculate the actual replacement value for preview
                            replacement_preview = check.replacement
                            if check.replacement:
                                # Convert $1, $2 to \1, \2 for Python regex
                                import re
                                converted_replacement = re.sub(r'\$(\d+)', r'\\\1', check.replacement)
                                # Apply replacement to the matched text to get preview
                                try:
                                    replacement_preview = regex_proc.regex_module.sub(
                                        check.pattern,
                                        converted_replacement,
                                        matched,
                                        flags=flags
                                    )
                                except:
                                    replacement_preview = check.replacement  # Fallback to template

                            all_results.append({
                                'tu_id': tu.id,
                                'check_name': check.name,
                                'check_order': check.order,
                                'category': check.category,
                                'description': check.description,
                                'source': tu.get_source_text(),
                                'target': target_text,
                                'match': matched,
                                'match_start': start,
                                'match_end': end,
                                'pattern': check.pattern,
                                'replacement': replacement_preview
                            })

            # Output JSON
            output = {
                'profile_name': profile.name,
                'file': args.file,
                'total_matches': len(all_results),
                'matches': all_results
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))

        except Exception as e:
            print(json.dumps({"error": str(e)}))
            return 1
    else:
        # Human-readable output mode
        print(f"Running QA checks on: {args.file}")
        print(f"QA Profile: {args.profile}")
        print()

        # Load QA profile
        profile = QAProfileManager.load_from_xml(args.profile)
        print(f"Profile: {profile.name}")
        print(f"Description: {profile.description}")
        print()

        # Parse XLIFF
        parser = XLIFFParser(args.file)
        if not parser.parse():
            print("Failed to parse XLIFF file")
            return 1

        # Create regex processor
        regex_proc = RegexProcessor()

        # Get enabled checks
        enabled_checks = QAProfileManager.get_enabled_checks(profile)
        print(f"Running {len(enabled_checks)} enabled checks...")
        print("─" * 60)
        print()

        total_matches = 0

        for check in enabled_checks:
            print(f"[{check.order}] {check.name}")
            print(f"    Pattern: {check.pattern}")
            if check.exclude_pattern:
                print(f"    Exclude: {check.exclude_pattern}")

            # Validate pattern
            is_valid, error = regex_proc.validate_pattern(check.pattern)
            if not is_valid:
                print(f"    ✗ Invalid pattern: {error}")
                print()
                continue

            flags = 0 if check.case_sensitive else regex_proc.regex_module.IGNORECASE
            check_matches = 0

            for tu in parser.get_trans_units():
                target_text = tu.get_target_text()
                if target_text:
                    matches = regex_proc.find_in_text(
                        target_text,
                        check.pattern,
                        flags=flags,
                        ignore_tags=True,
                        exclude_pattern=check.exclude_pattern
                    )

                    if matches:
                        for start, end, matched in matches:
                            print(f"    [TU {tu.id}] '{matched}' (pos {start}-{end})")
                            check_matches += 1
                            total_matches += 1

            if check_matches > 0:
                print(f"    ✓ Found {check_matches} match(es)")
            else:
                print(f"    ○ No matches")
            print()

        print("─" * 60)
        print(f"Total matches found: {total_matches}")

    return 0


def batch_replace_command(args):
    """Execute batch replace operation using a QA profile."""
    print(f"Running batch replacements on: {args.file}")
    print(f"QA Profile: {args.profile}")
    print()

    # Load QA profile
    profile = QAProfileManager.load_from_xml(args.profile)
    print(f"Profile: {profile.name}")
    print(f"Description: {profile.description}")
    print()

    # Create backup
    if not args.no_backup:
        backup_mgr = BackupManager()
        backup_path = backup_mgr.create_backup(args.file)
        if backup_path:
            print(f"Backup created: {backup_path}\n")
        else:
            print("Warning: Backup failed\n")

    # Parse XLIFF
    parser = XLIFFParser(args.file)
    if not parser.parse():
        print("Failed to parse XLIFF file")
        return 1

    # Create regex processor
    regex_proc = RegexProcessor()

    # Get enabled checks that have replacements
    enabled_checks = [c for c in QAProfileManager.get_enabled_checks(profile) if c.replacement]
    print(f"Running {len(enabled_checks)} enabled replacements...")
    print("─" * 60)
    print()

    total_replacements = 0
    total_units_modified = 0

    # Track which TUs were modified to avoid duplicate modifications
    modified_tus = set()

    for check in enabled_checks:
        print(f"[{check.order}] {check.name}")
        print(f"    Pattern: {check.pattern}")
        print(f"    Replacement: {check.replacement}")
        if check.exclude_pattern:
            print(f"    Exclude: {check.exclude_pattern}")

        # Validate pattern
        is_valid, error = regex_proc.validate_pattern(check.pattern)
        if not is_valid:
            print(f"    ✗ Invalid pattern: {error}")
            print()
            continue

        flags = 0 if check.case_sensitive else regex_proc.regex_module.IGNORECASE
        check_replacements = 0
        check_units = 0

        for tu in parser.get_trans_units():
            target_text = tu.get_target_text()
            if target_text:
                new_text, count = regex_proc.replace_in_text(
                    target_text,
                    check.pattern,
                    check.replacement,
                    flags=flags,
                    ignore_tags=True,
                    exclude_pattern=check.exclude_pattern
                )

                if count > 0:
                    print(f"    [TU {tu.id}] {count} replacement(s)")
                    print(f"      Before: {target_text[:60]}...")
                    print(f"      After:  {new_text[:60]}...")

                    tu.set_target_text(new_text)
                    check_replacements += count
                    check_units += 1
                    modified_tus.add(tu.id)

        if check_replacements > 0:
            print(f"    ✓ {check_replacements} replacement(s) in {check_units} unit(s)")
            total_replacements += check_replacements
        else:
            print(f"    ○ No replacements")
        print()

    total_units_modified = len(modified_tus)

    # Save modified file
    if total_replacements > 0:
        output_path = args.output if args.output else args.file
        if parser.save(output_path):
            print("─" * 60)
            print("Success!")
            print(f"Modified units: {total_units_modified}")
            print(f"Total replacements: {total_replacements}")
            print(f"Saved to: {output_path}")
        else:
            print("Failed to save file")
            return 1
    else:
        print("No replacements made - file unchanged")

    # JSON output for GUI
    if args.json:
        result = {
            'success': total_replacements > 0,
            'modified_units': total_units_modified,
            'total_replacements': total_replacements,
            'output_path': args.output if args.output else args.file
        }
        print(json.dumps(result))

    return 0


def replace_command(args):
    """Execute replace operation."""
    print(f"Processing: {args.file}")
    print(f"Pattern: {args.pattern}")
    print(f"Replacement: {args.replacement}")
    print()

    # Create backup
    if not args.no_backup:
        backup_mgr = BackupManager()
        backup_path = backup_mgr.create_backup(args.file)
        if backup_path:
            print(f"Backup created: {backup_path}\n")
        else:
            print("Warning: Backup failed\n")

    # Parse XLIFF
    parser = XLIFFParser(args.file)
    if not parser.parse():
        print("Failed to parse XLIFF file")
        return 1

    # Create regex processor
    regex_proc = RegexProcessor()

    # Validate pattern
    is_valid, error = regex_proc.validate_pattern(args.pattern)
    if not is_valid:
        print(f"Invalid regex pattern: {error}")
        return 1

    # Replace in translation units
    total_replacements = 0
    modified_units = 0
    flags = 0 if args.case_sensitive else regex_proc.regex_module.IGNORECASE

    for tu in parser.get_trans_units():
        # Replace in target (default)
        if args.target or (not args.source and not args.target):
            target_text = tu.get_target_text()
            if target_text:
                exclude = getattr(args, 'exclude', None)
                new_text, count = regex_proc.replace_in_text(
                    target_text,
                    args.pattern,
                    args.replacement,
                    flags=flags,
                    ignore_tags=not args.include_tags,
                    max_replacements=args.max_replacements if args.max_replacements > 0 else 0,
                    exclude_pattern=exclude
                )

                if count > 0:
                    print(f"[TU: {tu.id}] TARGET:")
                    print(f"  Before: {target_text}")
                    print(f"  After:  {new_text}")
                    print(f"  Replacements: {count}\n")

                    tu.set_target_text(new_text)
                    total_replacements += count
                    modified_units += 1

        # Replace in source (if requested)
        if args.source:
            print("Warning: Replacing in source segments is not recommended")
            # Implementation would go here if needed

    # Save modified file
    if total_replacements > 0:
        output_path = args.output if args.output else args.file
        if parser.save(output_path):
            print(f"\nSuccess!")
            print(f"Modified units: {modified_units}")
            print(f"Total replacements: {total_replacements}")
            print(f"Saved to: {output_path}")

            # Offer to save pattern if --save flag is set
            if hasattr(args, 'save') and args.save:
                print("\n" + "─" * 60)
                print("Save this replacement pattern to library?")
                name = input("Pattern name (or press Enter to skip): ").strip()

                if name:
                    library = PatternLibrary()
                    library.load_custom_patterns()

                    description = input("Description (optional): ").strip()
                    category = input("Category (default: Custom): ").strip() or "Custom"

                    new_pattern = Pattern(
                        name=name,
                        pattern=args.pattern,
                        replacement=args.replacement,
                        description=description,
                        category=category,
                        case_sensitive=args.case_sensitive,
                        enabled=True,
                        tags=["saved-from-replace"]
                    )

                    if library.add_pattern(new_pattern):
                        if library.save_custom_patterns():
                            print(f"✓ Pattern '{name}' saved to library!")
                            print(f"  Use it later with: python src/cli.py patterns apply --name \"{name}\" --file FILE")
                        else:
                            print("✗ Failed to save pattern")
                    else:
                        print("✗ Pattern with that name already exists")

        else:
            print("\nFailed to save file")
            return 1
    else:
        print("\nNo replacements made")

    return 0


def stats_command(args):
    """Show statistics about XLIFF/TMX file."""
    import json

    target_lang = getattr(args, 'target_lang', None)
    parser = get_parser(args.file, target_lang)
    if not parser.parse():
        if args.json:
            print(json.dumps({"error": "Failed to parse XLIFF file"}))
        else:
            print("Failed to parse XLIFF file")
        return 1

    stats = parser.get_statistics()

    if args.json:
        # Output JSON for GUI integration
        trans_units = []
        for tu in parser.get_trans_units():
            # Extract metadata from trans-unit element
            metadata = {}

            # Common XLIFF metadata attributes
            if tu.element is not None:
                # Match quality/percentage from different CAT tools
                if 'percent' in tu.element.attrib:
                    metadata['match_percent'] = tu.element.get('percent')
                if 'match-quality' in tu.element.attrib:
                    metadata['match_quality'] = tu.element.get('match-quality')

                # Locked/approved status
                if 'translate' in tu.element.attrib:
                    metadata['translate'] = tu.element.get('translate')
                    # translate="no" means the segment is locked/non-translatable
                    if tu.element.get('translate') == 'no':
                        metadata['locked'] = 'yes'
                if 'approved' in tu.element.attrib:
                    metadata['approved'] = tu.element.get('approved')

                # MemoQ MQXLIFF specific metadata (mq: namespace)
                # Check for mq: namespace attributes
                for attr_name, attr_value in tu.element.attrib.items():
                    # Skip empty values
                    if not attr_value or attr_value.strip() == '':
                        continue

                    # MemoQ status
                    if 'status' in attr_name.lower() and 'mq' in attr_name.lower():
                        metadata['state'] = attr_value
                    # MemoQ match percent
                    elif 'percent' in attr_name.lower() and 'mq' in attr_name.lower():
                        metadata['match_percent'] = attr_value
                    # MemoQ last changing user
                    elif 'lastchanginguser' in attr_name.lower():
                        metadata['modified_by'] = attr_value
                    # MemoQ last changed timestamp
                    elif 'lastchangedtimestamp' in attr_name.lower():
                        # Only set if it's a valid timestamp (not 0001-01-01)
                        if not attr_value.startswith('0001'):
                            metadata['modified_date'] = attr_value.replace('T', ' ').replace('Z', '')
                    # MemoQ locked status
                    elif 'locked' in attr_name.lower() and 'mq' in attr_name.lower():
                        metadata['locked'] = 'yes' if attr_value.lower() in ('true', '1', 'locked') else 'no'
                    # MemoQ translator commit username
                    elif 'translatorcommitusername' in attr_name.lower():
                        metadata['created_by'] = attr_value
                    # MemoQ translator commit timestamp
                    elif 'translatorcommittimestamp' in attr_name.lower():
                        # Only set if it's a valid timestamp (not 0001-01-01)
                        if not attr_value.startswith('0001'):
                            metadata['created_date'] = attr_value.replace('T', ' ').replace('Z', '')

                # Phrase MXLIFF specific metadata (m: namespace)
                # Extract attributes with {Memsource} or {m:} namespace prefix
                for attr_name, attr_value in tu.element.attrib.items():
                    # Handle Phrase/Memsource custom attributes
                    if 'confirmed' in attr_name.lower():
                        metadata['approved'] = 'yes' if attr_value == '1' else 'no'
                    elif 'score' in attr_name.lower() and 'gross' not in attr_name.lower():
                        metadata['match_percent'] = str(int(float(attr_value) * 100))
                    elif 'locked' in attr_name.lower():
                        metadata['locked'] = 'yes' if attr_value.lower() in ('true', '1', 'locked') else 'no'
                    elif 'modified-at' in attr_name.lower():
                        # Convert timestamp to readable format
                        from datetime import datetime
                        try:
                            timestamp = int(attr_value) / 1000  # Convert from milliseconds
                            dt = datetime.fromtimestamp(timestamp)
                            metadata['modified_date'] = dt.strftime('%Y-%m-%d %H:%M:%S')
                        except:
                            metadata['modified_date'] = attr_value
                    elif 'modified-by' in attr_name.lower():
                        metadata['modified_by'] = attr_value
                    elif 'created-at' in attr_name.lower():
                        from datetime import datetime
                        try:
                            timestamp = int(attr_value) / 1000
                            dt = datetime.fromtimestamp(timestamp)
                            metadata['created_date'] = dt.strftime('%Y-%m-%d %H:%M:%S')
                        except:
                            metadata['created_date'] = attr_value
                    elif 'created-by' in attr_name.lower():
                        metadata['created_by'] = attr_value
                    elif 'trans-origin' in attr_name.lower():
                        metadata['origin'] = attr_value

                # Modified date/user - check target element (standard XLIFF)
                if tu.target is not None:
                    if 'changedate' in tu.target.attrib:
                        metadata['modified_date'] = tu.target.get('changedate')
                    if 'changeid' in tu.target.attrib:
                        metadata['modified_by'] = tu.target.get('changeid')
                    if 'state' in tu.target.attrib:
                        metadata['state'] = tu.target.get('state')

                # SDLXLIFF specific metadata from <sdl:seg-defs>
                # Look for sdl:seg-defs element
                sdl_ns = {'sdl': 'http://sdl.com/FileTypes/SdlXliff/1.0'}
                seg_defs = tu.element.find('.//sdl:seg-defs', namespaces=sdl_ns)
                if seg_defs is not None:
                    # Find first sdl:seg element
                    seg = seg_defs.find('sdl:seg', namespaces=sdl_ns)
                    if seg is not None:
                        # Extract percent, conf (state), origin
                        if 'percent' in seg.attrib:
                            metadata['match_percent'] = seg.get('percent')
                        if 'conf' in seg.attrib:
                            metadata['state'] = seg.get('conf')
                        if 'origin' in seg.attrib:
                            metadata['origin'] = seg.get('origin')
                        if 'origin-system' in seg.attrib:
                            origin_system = seg.get('origin-system')
                            if origin_system:
                                if 'origin' in metadata:
                                    metadata['origin'] = f"{metadata['origin']} ({origin_system})"
                                else:
                                    metadata['origin'] = origin_system

                # XTM / standard XLIFF: match-quality on first <alt-trans>
                if 'match_percent' not in metadata or not metadata['match_percent']:
                    alt_trans = tu.element.find('alt-trans')
                    if alt_trans is not None and 'match-quality' in alt_trans.attrib:
                        raw = alt_trans.get('match-quality', '').rstrip('%')
                        try:
                            metadata['match_percent'] = str(int(float(raw)))
                        except (ValueError, TypeError):
                            pass

                # XTM fallback: state-qualifier on <target> → 100%
                if 'match_percent' not in metadata or not metadata['match_percent']:
                    if tu.target is not None:
                        sq = tu.target.get('state-qualifier', '')
                        if 'exact-match' in sq or 'leveraged-tm' in sq:
                            metadata['match_percent'] = '100'

            # ICU validation
            source_text = tu.get_source_text()
            target_text = tu.get_target_text()
            icu_errors = None

            if ICUValidator.has_icu_syntax(source_text) or ICUValidator.has_icu_syntax(target_text):
                errors = ICUValidator.validate_segment(source_text, target_text)
                if errors:
                    icu_errors = errors

            trans_units.append({
                "id": tu.id,
                "source": source_text,
                "target": target_text,
                "metadata": metadata if metadata else None,
                "icu_errors": icu_errors,
                "tms_metadata": tu.tms_metadata
            })

        # Filter out empty/structural segments (only tags, no text content)
        # These are common in SDLXLIFF files
        filtered_units = []
        for unit in trans_units:
            # Check if source has actual text (not just tags like <x id="4"/>)
            source = unit['source']
            # Skip if source is empty or only contains inline tags
            if source and not (source.strip().startswith('<x ') and source.strip().endswith('/>')) and source.strip() not in ['', '<x/>', '<g/>']:
                filtered_units.append(unit)

        # Use filtered units if they exist, otherwise use all
        display_units = filtered_units if filtered_units else trans_units

        # Add sequential segment numbers (1, 2, 3...) for display
        # Keep original ID intact so save/apply-edits can match correctly
        for idx, unit in enumerate(display_units, start=1):
            unit['segment_number'] = idx

        # Recalculate stats based on filtered display_units
        filtered_stats = {
            'total_units': len(display_units),
            'translated': sum(1 for u in display_units if u['target'] and u['target'].strip()),
            'untranslated': sum(1 for u in display_units if not u['target'] or not u['target'].strip())
        }

        output = {
            "trans_units": display_units,
            "stats": filtered_stats
        }
        print(json.dumps(output))
    else:
        # Human-readable output
        print(f"XLIFF Statistics for: {args.file}")
        print(f"{'─' * 50}")
        print(f"Total translation units: {stats['total_units']}")
        print(f"Translated: {stats['translated']}")
        print(f"Untranslated: {stats['untranslated']}")

        if stats['total_units'] > 0:
            completion = (stats['translated'] / stats['total_units']) * 100
            print(f"Completion: {completion:.1f}%")

    return 0



def apply_edits_command(args):
    """Apply edits from JSON file to XLIFF or TMX."""
    import json

    # Read edits from JSON file
    try:
        with open(args.edits_json, 'r', encoding='utf-8') as f:
            edits = json.load(f)
    except Exception as e:
        print(f"Failed to read edits JSON: {e}")
        return 1

    # Parse file (XLIFF or TMX)
    target_lang = getattr(args, 'target_lang', None)
    parser = get_parser(args.file, target_lang)
    if not parser.parse():
        print("Failed to parse file")
        return 1

    # Create backup
    backup_mgr = BackupManager()
    backup_path = backup_mgr.create_backup(args.file)
    if backup_path:
        print(f"Backup created: {backup_path}")

    # Apply edits
    edits_dict = {edit['id']: edit['target'] for edit in edits}

    try:
        for tu in parser.get_trans_units():
            if tu.id in edits_dict:
                tu.set_target_text(edits_dict[tu.id])

        # Save modified XLIFF
        if parser.save(args.file):
            print(f"Successfully saved {len(edits_dict)} edits to {args.file}")
            return 0
        else:
            print("Failed to save XLIFF file")
            return 1
    except Exception as e:
        print(f"Error applying edits: {e}")
        return 1


# ─── SpellcheckQA commands (sc- prefix) ─────────────────────────────────────

def _sc_out(data) -> None:
    """Write JSON to stdout for sc- commands."""
    print(json.dumps(data, ensure_ascii=False))


def _sc_err(msg: str) -> None:
    print(msg, file=sys.stderr)


def _sc_parse_and_convert(file_path: str):
    """Parse XLIFF/docx and return (parser_or_None, segments).
    For docx files, parser is None (no write-back supported).
    """
    ext = Path(file_path).suffix.lower()
    if ext == ".docx":
        try:
            segments = parse_phrase_docx(file_path)
            return None, segments
        except Exception as e:
            import sys
            print(f"Error parsing docx: {e}", file=sys.stderr)
            return None, None
    parser = XLIFFParser(file_path)
    if not parser.parse():
        return None, None
    segments = trans_units_to_segments(parser.get_trans_units(), Path(file_path).name)
    return parser, segments


def sc_load_file_command(args):
    ext = Path(args.file).suffix.lower()
    is_docx = ext == ".docx"

    parser, segments = _sc_parse_and_convert(args.file)
    if segments is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1

    out_segments = [
        {"id": s.id, "source": s.source_plain, "target": s.target_plain, "file_name": s.file_name}
        for s in segments
    ]
    stats = {
        "total_segments": len(segments),
        "translated": sum(1 for s in segments if s.target_plain.strip()),
        "untranslated": sum(1 for s in segments if not s.target_plain.strip()),
        "locked": sum(1 for s in segments if s.is_locked),
    }

    # Extract target language — from XLIFF metadata or docx filename heuristic
    target_language = ""
    if not is_docx and parser is not None:
        try:
            nsmap = parser.root.nsmap
            default_ns = nsmap.get(None, 'urn:oasis:names:tc:xliff:document:1.2')
            file_elements = parser.root.xpath(".//ns:file", namespaces={'ns': default_ns})
            if file_elements:
                target_language = file_elements[0].get("target-language", "")
        except Exception:
            pass
    elif is_docx:
        # Try to infer from filename: "nb-NO_job123-en-no-T.docx" → "nb-NO"
        stem = Path(args.file).stem
        parts = stem.split("_")
        if parts:
            first = parts[0]
            if re.match(r"^[a-z]{2}(-[A-Z]{2})?$", first):
                target_language = first

    _sc_out({"segments": out_segments, "target_language": target_language,
             "stats": stats, "is_docx": is_docx})
    return 0


def sc_list_dics_command(args):
    dics = list_dics(args.folder)
    _sc_out([asdict(d) for d in dics])
    return 0


def sc_load_settings_command(args):
    s = load_settings_obj()
    _sc_out(asdict(s))
    return 0


def sc_save_settings_command(args):
    try:
        data = json.loads(args.data)
        s = Settings(
            dic_folder=data.get("dic_folder", ""),
            selected_dics=data.get("selected_dics", []),
            termlists=data.get("termlists", []),
            checklists=data.get("checklists", []),
            backup_enabled=data.get("backup_enabled", True),
            strict_lang_match=data.get("strict_lang_match", False),
            skip_locked=data.get("skip_locked", True),
            skip_100_match=data.get("skip_100_match", True),
            compound_check=data.get("compound_check", True),
            watch_folder_enabled=data.get("watch_folder_enabled", False),
            watch_folder=data.get("watch_folder", ""),
            qa_checks=data.get("qa_checks", {}),
        )
        save_settings_obj(s)
        _sc_out({"ok": True})
    except Exception as e:
        _sc_err(f"Failed to save settings: {e}")
        return 1
    return 0


def sc_run_spellcheck_command(args):
    parser, segments = _sc_parse_and_convert(args.file)
    if parser is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1
    dic_paths = [d.strip() for d in args.dics.split(",") if d.strip()] if args.dics else []
    dicts = load_all_dictionaries(dic_paths)
    if not dicts:
        _sc_err("No dictionaries loaded")
        return 1
    excl_paths = [p.strip() for p in args.exclusion_files.split(",") if p.strip()] if args.exclusion_files else []
    exclusion_set = build_exclusion_set(excl_paths)
    skip_locked = (args.skip_locked.lower() != "false") if args.skip_locked else True
    compound_check = (args.compound_check.lower() != "false") if args.compound_check else True
    skip_100_match = (args.skip_100_match.lower() != "false") if args.skip_100_match else True
    flagged = run_spellcheck(segments, dicts, exclusion_set,
                             skip_locked=skip_locked, compound_check=compound_check,
                             skip_100_match=skip_100_match)
    _sc_out({
        "flagged_words": [
            {"word": fw.word, "count": fw.count, "segment_ids": fw.segment_ids}
            for fw in flagged
        ]
    })
    return 0


def sc_get_suggestions_command(args):
    dic_paths = [p.strip() for p in args.dics.split(",") if p.strip()]
    dicts = load_all_dictionaries(dic_paths)
    suggestions = get_suggestions(args.word, dicts)
    _sc_out({"suggestions": suggestions})
    return 0


def sc_add_to_dic_command(args):
    backup = args.backup.lower() == "true" if args.backup else True
    new_count = add_word(args.word, args.dic, backup=backup)
    if new_count < 0:
        _sc_err(f"Failed to add '{args.word}' to {args.dic}")
        return 1
    _sc_out({"word_count": new_count, "word": args.word})
    return 0


def sc_get_segments_for_word_command(args):
    import re as re_mod
    parser, segments = _sc_parse_and_convert(args.file)
    if parser is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1
    pattern = r"(?<!\w)" + re_mod.escape(args.word) + r"(?!\w)"
    matching = []
    for seg in segments:
        if re_mod.search(pattern, seg.target_plain, re_mod.IGNORECASE):
            matching.append({
                "id": seg.id, "source": seg.source_plain,
                "target": seg.target_plain, "file_name": seg.file_name,
            })
        if len(matching) >= 5:
            break
    _sc_out({"segments": matching, "word": args.word})
    return 0


def sc_apply_spellcheck_edits_command(args):
    try:
        with open(args.edits_file, "r", encoding="utf-8") as f:
            edits = json.load(f)
    except Exception as e:
        _sc_err(f"Failed to read edits file: {e}")
        return 1

    xliff_path = Path(args.file)
    xliff_parser = XLIFFParser(str(xliff_path))
    if not xliff_parser.parse():
        _sc_err(f"Failed to parse: {args.file}")
        return 1

    import shutil
    backup_path = str(xliff_path) + ".bak"
    shutil.copy2(xliff_path, backup_path)

    # Build lookup from segments adapter for write-back
    segments = trans_units_to_segments(xliff_parser.get_trans_units(), xliff_path.name)
    seg_map = {s.id: s for s in segments}

    for edit in edits:
        seg_id = edit.get("id", "")
        new_target = edit.get("target", "")
        if seg_id and seg_id in seg_map:
            seg = seg_map[seg_id]
            elem = seg.target_element
            if elem is not None:
                elem.clear()
                elem.text = new_target
                seg.target_plain = new_target
                seg.target_raw = new_target

    if not xliff_parser.save():
        _sc_err("Failed to save XLIFF")
        return 1
    _sc_out({"ok": True, "backup_path": backup_path})
    return 0


def sc_run_term_check_command(args):
    parser, segments = _sc_parse_and_convert(args.file)
    if parser is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1

    # Extract source/target language from XLIFF so TBX parsing picks correct langSets
    source_lang = getattr(args, 'source_lang', None) or "en"
    target_lang = getattr(args, 'target_lang', None) or ""
    if not target_lang:
        try:
            nsmap = parser.root.nsmap
            default_ns = nsmap.get(None, 'urn:oasis:names:tc:xliff:document:1.2')
            file_elements = parser.root.xpath(".//ns:file", namespaces={'ns': default_ns})
            if file_elements:
                target_lang = file_elements[0].get("target-language", "")
                if not source_lang or source_lang == "en":
                    source_lang = file_elements[0].get("source-language", "en")
        except Exception:
            pass

    term_entries = []
    if args.termlists:
        for path in args.termlists.split(","):
            path = path.strip()
            if path:
                term_entries.extend(load_termlist(path, source_lang=source_lang, target_lang=target_lang))
    check_rules = []
    if args.checklists:
        for path in args.checklists.split(","):
            path = path.strip()
            if path:
                check_rules.extend(load_checklist(path))
    skip_locked = (args.skip_locked.lower() != "false") if args.skip_locked else True
    skip_100_match = (args.skip_100_match.lower() != "false") if args.skip_100_match else True
    violations = check_segments(segments, term_entries, check_rules,
                                skip_locked=skip_locked, skip_100_match=skip_100_match)
    _sc_out({
        "violations": [
            {
                "segment_id": v.segment_id, "file_name": v.file_name,
                "violation_type": v.violation_type, "source_term": v.source_term,
                "target_term": v.target_term, "description": v.description,
                "source_text": v.source_text, "target_text": v.target_text,
                "check_source": v.check_source,
                "match_percent": getattr(v, 'match_percent', None),
            } for v in violations
        ]
    })
    return 0


def sc_run_number_check_command(args):
    parser, segments = _sc_parse_and_convert(args.file)
    if parser is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1
    skip_locked = (args.skip_locked.lower() != "false") if args.skip_locked else True
    skip_100_match = (args.skip_100_match.lower() != "false") if args.skip_100_match else True
    violations = check_numbers(segments, skip_locked=skip_locked, skip_100_match=skip_100_match)
    _sc_out({
        "violations": [
            {
                "segment_id": v.segment_id, "file_name": v.file_name,
                "violation_type": v.violation_type, "source_term": v.source_term,
                "target_term": v.target_term, "description": v.description,
                "source_text": v.source_text, "target_text": v.target_text,
                "check_source": v.check_source,
                "match_percent": getattr(v, 'match_percent', None),
            } for v in violations
        ]
    })
    return 0


def sc_run_qa_checks_command(args):
    parser, segments = _sc_parse_and_convert(args.file)
    if parser is None:
        _sc_err(f"Failed to parse: {args.file}")
        return 1
    skip_locked = (args.skip_locked.lower() != "false") if args.skip_locked else True
    skip_100_match = (args.skip_100_match.lower() != "false") if args.skip_100_match else True
    if args.checks == "all" or not args.checks:
        enabled = {k: True for k in ALL_QA_CHECKS}
    elif args.checks == "none":
        enabled = {k: False for k in ALL_QA_CHECKS}
    else:
        check_ids = {c.strip() for c in args.checks.split(",")}
        enabled = {k: (k in check_ids) for k in ALL_QA_CHECKS}
    violations = run_qa_checks(segments, enabled, skip_locked=skip_locked, skip_100_match=skip_100_match)
    _sc_out({
        "violations": [
            {
                "segment_id": v.segment_id, "file_name": v.file_name,
                "violation_type": v.violation_type, "source_term": v.source_term,
                "target_term": v.target_term, "description": v.description,
                "source_text": v.source_text, "target_text": v.target_text,
                "check_source": v.check_source,
                "match_percent": getattr(v, 'match_percent', None),
            } for v in violations
        ]
    })
    return 0


def sc_scan_watch_folder_command(args):
    files = scan_folder(args.folder)
    _sc_out({"files": files})
    return 0


def sc_merge_files_command(args):
    input_files = [f.strip() for f in args.files.split(",") if f.strip()]
    folder = str(Path(input_files[0]).parent) if input_files else "."
    output_path = args.output or suggest_output_name(input_files, folder)
    result = merge_xliff_files(input_files, output_path)
    _sc_out(result)
    return 0


def sc_save_report_xlsx_command(args):
    spell_errors = json.loads(args.spell_errors) if args.spell_errors else []
    violations = json.loads(args.violations) if args.violations else []
    result = generate_xlsx_report(
        file_path=args.file_path,
        spell_errors=spell_errors,
        violations=violations,
        output_path=args.output_path,
        app_version=getattr(args, "app_version", "") or "",
    )
    _sc_out({"ok": True, "path": result})
    return 0


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Nitpick CLI - XLIFF RegEx & Spellcheck QA Tool'
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Find command
    find_parser = subparsers.add_parser('find', help='Find pattern in XLIFF file')
    find_parser.add_argument('file', help='XLIFF file path')
    find_parser.add_argument('pattern', help='Regex pattern to find')
    find_parser.add_argument('--source', action='store_true', help='Search in source segments')
    find_parser.add_argument('--target', action='store_true', help='Search in target segments')
    find_parser.add_argument('--case-sensitive', action='store_true', help='Case sensitive search')
    find_parser.add_argument('--include-tags', action='store_true', help='Include XML tags in search')
    find_parser.add_argument('--exclude', help='Exclude pattern (e.g., "19\\d{2}|20\\d{2}" to skip years)')
    find_parser.add_argument('--save', action='store_true', help='Offer to save pattern to library after search')
    find_parser.set_defaults(func=find_command)

    # Batch find command
    batch_find_parser = subparsers.add_parser('batch-find', help='Run multiple regex checks using a QA profile')
    batch_find_parser.add_argument('file', help='XLIFF file path')
    batch_find_parser.add_argument('profile', help='QA profile XML file path')
    batch_find_parser.add_argument('--json', action='store_true', help='Output as JSON (for GUI integration)')
    batch_find_parser.set_defaults(func=batch_find_command)

    # Batch replace command
    batch_replace_parser = subparsers.add_parser('batch-replace', help='Run multiple regex replacements using a QA profile')
    batch_replace_parser.add_argument('file', help='XLIFF file path')
    batch_replace_parser.add_argument('profile', help='QA profile XML file path')
    batch_replace_parser.add_argument('--output', '-o', help='Output file (default: overwrite input)')
    batch_replace_parser.add_argument('--no-backup', action='store_true', help='Skip backup creation')
    batch_replace_parser.add_argument('--json', action='store_true', help='Output as JSON (for GUI integration)')
    batch_replace_parser.set_defaults(func=batch_replace_command)

    # Replace command
    replace_parser = subparsers.add_parser('replace', help='Replace pattern in XLIFF file')
    replace_parser.add_argument('file', help='XLIFF file path')
    replace_parser.add_argument('pattern', help='Regex pattern to find')
    replace_parser.add_argument('replacement', help='Replacement string')
    replace_parser.add_argument('--output', '-o', help='Output file (default: overwrite input)')
    replace_parser.add_argument('--source', action='store_true', help='Replace in source segments')
    replace_parser.add_argument('--target', action='store_true', help='Replace in target segments')
    replace_parser.add_argument('--case-sensitive', action='store_true', help='Case sensitive search')
    replace_parser.add_argument('--include-tags', action='store_true', help='Include XML tags in replacement')
    replace_parser.add_argument('--no-backup', action='store_true', help='Skip backup creation')
    replace_parser.add_argument('--max-replacements', type=int, default=0,
                               help='Maximum replacements per segment (0 = unlimited)')
    replace_parser.add_argument('--exclude', help='Exclude pattern (e.g., "19\\d{2}|20\\d{2}" to skip years)')
    replace_parser.add_argument('--save', action='store_true', help='Offer to save pattern to library after replacement')
    replace_parser.set_defaults(func=replace_command)

    # Stats command
    stats_parser = subparsers.add_parser('stats', help='Show XLIFF/TMX file statistics')
    stats_parser.add_argument('file', help='XLIFF or TMX file path')
    stats_parser.add_argument('--json', action='store_true', help='Output as JSON')
    stats_parser.add_argument('--target-lang', help='Target language code (for TMX files with multiple languages)')
    stats_parser.set_defaults(func=stats_command)

    # TMX languages command
    tmx_languages_parser = subparsers.add_parser('tmx-languages', help='List available languages in a TMX file')
    tmx_languages_parser.add_argument('file', help='TMX file path')
    tmx_languages_parser.set_defaults(func=tmx_languages_command)

    # Apply-edits command (for GUI integration)
    apply_edits_parser = subparsers.add_parser('apply-edits', help='Apply edits from JSON file')
    apply_edits_parser.add_argument('file', help='XLIFF or TMX file path')
    apply_edits_parser.add_argument('edits_json', help='JSON file with edits')
    apply_edits_parser.add_argument('--target-lang', help='Target language code (for TMX files with multiple languages)')
    apply_edits_parser.set_defaults(func=apply_edits_command)

    # ─── SpellcheckQA subcommands (sc- prefix) ──────────────────────────────

    p = subparsers.add_parser('sc-load-file')
    p.add_argument('--file', required=True)
    p.set_defaults(func=sc_load_file_command)

    p = subparsers.add_parser('sc-list-dics')
    p.add_argument('--folder', required=True)
    p.set_defaults(func=sc_list_dics_command)

    p = subparsers.add_parser('sc-load-settings')
    p.set_defaults(func=sc_load_settings_command)

    p = subparsers.add_parser('sc-save-settings')
    p.add_argument('--data', required=True)
    p.set_defaults(func=sc_save_settings_command)

    p = subparsers.add_parser('sc-run-spellcheck')
    p.add_argument('--file', required=True)
    p.add_argument('--dics', required=True)
    p.add_argument('--exclusion-files', default="")
    p.add_argument('--skip-locked', default="true")
    p.add_argument('--compound-check', default="true")
    p.add_argument('--skip-100-match', default="true")
    p.set_defaults(func=sc_run_spellcheck_command)

    p = subparsers.add_parser('sc-get-suggestions')
    p.add_argument('--word', required=True)
    p.add_argument('--dics', required=True)
    p.set_defaults(func=sc_get_suggestions_command)

    p = subparsers.add_parser('sc-add-to-dic')
    p.add_argument('--word', required=True)
    p.add_argument('--dic', required=True)
    p.add_argument('--backup', default="true")
    p.set_defaults(func=sc_add_to_dic_command)

    p = subparsers.add_parser('sc-get-segments-for-word')
    p.add_argument('--file', required=True)
    p.add_argument('--word', required=True)
    p.add_argument('--dics', default="")
    p.set_defaults(func=sc_get_segments_for_word_command)

    p = subparsers.add_parser('sc-apply-spellcheck-edits')
    p.add_argument('--file', required=True)
    p.add_argument('--edits-file', required=True)
    p.set_defaults(func=sc_apply_spellcheck_edits_command)

    p = subparsers.add_parser('sc-run-term-check')
    p.add_argument('--file', required=True)
    p.add_argument('--termlists', default="")
    p.add_argument('--checklists', default="")
    p.add_argument('--skip-locked', default="true")
    p.add_argument('--skip-100-match', default="true")
    p.add_argument('--source-lang', default="en")
    p.add_argument('--target-lang', default="")
    p.set_defaults(func=sc_run_term_check_command)

    p = subparsers.add_parser('sc-run-number-check')
    p.add_argument('--file', required=True)
    p.add_argument('--skip-locked', default="true")
    p.add_argument('--skip-100-match', default="true")
    p.set_defaults(func=sc_run_number_check_command)

    p = subparsers.add_parser('sc-run-qa-checks')
    p.add_argument('--file', required=True)
    p.add_argument('--skip-locked', default="true")
    p.add_argument('--skip-100-match', default="true")
    p.add_argument('--checks', default="all")
    p.set_defaults(func=sc_run_qa_checks_command)

    p = subparsers.add_parser('sc-scan-watch-folder')
    p.add_argument('--folder', required=True)
    p.set_defaults(func=sc_scan_watch_folder_command)

    p = subparsers.add_parser('sc-merge-files')
    p.add_argument('--files', required=True)
    p.add_argument('--output', default="")
    p.set_defaults(func=sc_merge_files_command)

    p = subparsers.add_parser('sc-save-report-xlsx')
    p.add_argument('--file-path', required=True)
    p.add_argument('--output-path', required=True)
    p.add_argument('--spell-errors', default="[]")
    p.add_argument('--violations', default="[]")
    p.add_argument('--app-version', default="")
    p.set_defaults(func=sc_save_report_xlsx_command)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
