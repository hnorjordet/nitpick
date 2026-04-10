# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['src/cli.py'],
    pathex=['src'],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Core
        'lxml',
        'lxml.etree',
        'lxml._elementpath',
        'regex',
        'spylls',
        'spylls.hunspell',
        'spylls.hunspell.dictionary',
        # Parsers
        'parsers',
        'parsers.xliff_parser',
        'parsers.mxliff_parser',
        'parsers.segment_adapter',
        'parsers.termlist_parser',
        # RegEx modules
        'regex_engine',
        'regex_engine.regex_processor',
        'backup',
        'backup.backup_manager',
        'qa',
        'qa.qa_profile',
        'validators',
        'validators.icu_validator',
        'patterns',
        'patterns.regex_patterns',
        # Reporting
        'reporting',
        'reporting.report_generator',
        'openpyxl',
        'openpyxl.styles',
        'openpyxl.utils',
        'et_xmlfile',
        # Spellcheck modules
        'spellcheck',
        'spellcheck.spell_engine',
        'spellcheck.dic_manager',
        'terminology',
        'terminology.term_checker',
        'qachecks',
        'qachecks.qa_checker',
        'qachecks.number_checker',
        'merging',
        'merging.xliff_merger',
        'settings',
        'settings.settings_manager',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='qa_app_cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
