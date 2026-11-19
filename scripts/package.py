import argparse
from pathlib import Path
from stat import S_IFREG
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent.parent
launchers = {"Windows": "啟動唱歌音準練習.cmd", "macOS": "啟動唱歌音準練習.command"}

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("platform", choices=launchers, nargs="+")
args = parser.parse_args()

for platform in args.platform:
    launcher = launchers[platform]
    if not (root / "dist/index.html").is_file():
        raise SystemExit("Run npm run build before packaging.")
    files = [root / name for name in ("package.json", "README.md", "LICENSE", launcher)]
    for directory in ("dist", "server"):
        files.extend(path for path in sorted((root / directory).rglob("*")) if path.is_file())
    args.output.mkdir(parents=True, exist_ok=True)
    prefix = "Intonavio_唱歌音準練習"
    with ZipFile(args.output / f"Intonavio-{platform}.zip", "w") as archive:
        for path in files:
            name = path.relative_to(root).as_posix()
            item = ZipInfo.from_file(path, f"{prefix}/{name}")
            item.create_system = 3
            mode = 0o755 if name.endswith(".command") else 0o644
            item.external_attr = (S_IFREG | mode) << 16
            archive.writestr(item, path.read_bytes(), compress_type=ZIP_DEFLATED)
