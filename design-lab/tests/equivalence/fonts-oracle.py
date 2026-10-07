"""Prepare offline font-plan expectations using the unchanged Python Site fixture."""
import json
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
assert str(root).startswith(('/tmp/', '/private/tmp/')), root
design_lab = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(design_lab / 'tests'))
sys.path.insert(0, str(design_lab / 'scripts'))
import test_fonts
import fonts

fonts.adobe_kit = lambda kit, timeout=8: None
FIGMA = test_fonts.PlanTests.FIGMA


def make_case(name, figma, configure=None, readable_kit=True, sitestudio=None):
    case = root / name
    case.mkdir(parents=True, exist_ok=True)
    fixture = test_fonts.PlanTests('test_the_family_the_visitor_sees_and_where_it_comes_from')
    fixture.setUp()
    try:
        if configure:
            configure(fixture)
        repo, run = case / 'repo', case / 'run'
        shutil.move(str(fixture.repo), repo)
        shutil.move(str(fixture.run), run)
        fixture.repo, fixture.run = repo, run
        config_path = repo / 'config/sitestudio' if sitestudio else None
        cache = run / 'fonts-kits.json'
        if not readable_kit:
            cache.unlink(missing_ok=True)
        document = fixture.plan(figma, kit=readable_kit, sitestudio=config_path)
        expected = {'plan': document, 'summary': fonts.summary_lines(document), 'repo': str(repo), 'run': str(run),
                    'figma': figma, 'sitestudio': str(config_path) if config_path else None}
        (case / 'expected.json').write_text(json.dumps(expected, indent=2, ensure_ascii=False) + '\n')
    finally:
        fixture.doCleanups()


def unicode_case(fixture):
    css = fixture.repo / 'docroot/themes/custom/site/css/latin.css'
    css.write_text('@font-face { font-family: Latin; src: url(../fonts/suisse/SuisseIntl-Regular.woff2); unicode-range: U+0000-00FF; }')
    fixture.measure(test_fonts.text_node('Latin, Arial, sans-serif', text='Hello'),
                    test_fonts.text_node('Latin, Arial, sans-serif', text='Шалом'))


def cdn_case(fixture):
    css = fixture.repo / 'docroot/themes/custom/site/css/cdn.css'
    css.write_text('@font-face { font-family: Brand; src: url("https://cdn.example/fonts/Brand-Semibold.woff2?v=2"); font-weight: 500; }')
    fixture.measure(test_fonts.text_node('Brand, sans-serif', '500'))


def config_case(fixture):
    config = fixture.repo / 'config/sitestudio'
    config.mkdir(parents=True)
    (config / 'cohesion_font.yml').write_text(
        'json_values: \'{"url":"https:\\/\\/fonts.googleapis.com\\/css2?family=Noto+Serif&display=swap"}\'\n')
    fixture.measure(test_fonts.text_node('Noto Serif, serif'))


make_case('unchecked', None)
make_case('figma-default', FIGMA)
without_arial_assistant = {name: styles for name, styles in FIGMA.items() if name not in ('Arial', 'Assistant')}
make_case('missing-arial-assistant', without_arial_assistant)
make_case('trial-family', {**FIGMA, 'Suisse Intl Trial': ['Regular', 'Semibold']})
make_case('unreadable-adobe-kit', FIGMA, readable_kit=False)
make_case('unicode-range', None, configure=unicode_case)
make_case('cdn-face', None, configure=cdn_case)
make_case('escaped-config-google', None, configure=config_case, sitestudio=True)


def copy_run_inputs(source, destination):
    destination.mkdir(parents=True)
    for name in ('project.json', 'fonts-kits.json'):
        path = source / name
        if path.is_file():
            shutil.copy2(path, destination / name)
    measurements = source / 'capture/measurements'
    if measurements.is_dir():
        shutil.copytree(measurements, destination / 'capture/measurements')
    available = source / 'figma/available-fonts.json'
    if available.is_file():
        target = destination / 'figma'
        target.mkdir()
        shutil.copy2(available, target / available.name)


frozen = []
for name, source in (
    ('frozen-pncb', Path.home() / '.design/pncb/2026-10-06'),
    ('frozen-definitive', Path.home() / 'Sites/DEFINITIVEHC/design/2026-10-05'),
):
    if not (source / 'project.json').is_file():
        continue
    case = root / name
    case.mkdir(parents=True, exist_ok=True)
    run = case / 'run'
    copy_run_inputs(source, run)
    project = json.loads((run / 'project.json').read_text())
    repository = Path(project['repository']['root'])
    assert repository.is_dir(), repository
    sitestudio = (project.get('decisions') or {}).get('sitestudioConfig')
    available_path = run / 'figma/available-fonts.json'
    figma = json.loads(available_path.read_text()) if available_path.is_file() else None
    document = fonts.finalise(fonts.plan(run, repository, Path(sitestudio) if sitestudio else None, figma))
    expected = {'plan': document, 'summary': fonts.summary_lines(document), 'repo': str(repository), 'run': str(run),
                'figma': figma, 'sitestudio': sitestudio}
    (case / 'expected.json').write_text(json.dumps(expected, indent=2, ensure_ascii=False) + '\n')
    frozen.append(name)

print(json.dumps({'synthetic': ['unchecked', 'figma-default', 'missing-arial-assistant', 'trial-family',
                                'unreadable-adobe-kit', 'unicode-range', 'cdn-face', 'escaped-config-google'],
                  'frozen': frozen}))
