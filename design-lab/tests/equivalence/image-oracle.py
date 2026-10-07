"""Fresh image conversion and Figma-fit bytes from the unchanged Python oracle, batch only."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import fetch_images, figma_runner
for row in json.loads(Path(sys.argv[1]).read_text()):
    source, target = Path(row['source']), Path(row['target'])
    assert str(target).startswith('/tmp/') or str(target).startswith('/private/tmp/')
    target.parent.mkdir(parents=True, exist_ok=True)
    if row['action'] == 'convert':
        data = fetch_images.convert(source.read_bytes(), row['contentType'])[0]
    else:
        data = figma_runner.fit_figma_image(source)
    target.write_bytes(data)
