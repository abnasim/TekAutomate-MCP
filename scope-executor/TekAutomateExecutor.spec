# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = [('app', 'app')]
binaries = [('.venv\\Lib\\site-packages\\3c22db458360489351e4__mypyc.cp312-win_amd64.pyd', '.'), ('.venv\\Lib\\site-packages\\81d243bd2c585b0f4821__mypyc.cp312-win_amd64.pyd', '.')]
hiddenimports = ['TKinterModernThemes', 'pystray', 'pyvisa', 'pyvisa_py', 'tm_devices', 'tekhsi', 'tomli', 'numpy', 'scipy', 'grpcio', 'grpcio_tools', 'numba', 'llvmlite', 'qrcode', 'PIL']
tmp_ret = collect_all('TKinterModernThemes')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tm_devices')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tekhsi')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('tomli')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['executor.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['PyQt5', 'PySide6', 'qdarkstyle'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='TekAutomateExecutor',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['app\\assets\\logo.ico'],
)
