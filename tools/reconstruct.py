"""Reconstruct exported working PNGs using a separately installed COLMAP. No pip deps."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone


def gpu_flag(help_text: str, stage: str) -> str:
    candidates = (['FeatureExtraction.use_gpu', 'SiftExtraction.use_gpu'] if stage == 'extract'
                  else ['FeatureMatching.use_gpu', 'SiftMatching.use_gpu'])
    for name in candidates:
        if name in help_text:
            return '--' + name
    raise ValueError('Не найдена поддерживаемая настройка CPU. Проверьте версию COLMAP.')


def registered_images(path: Path) -> int:
    lines = path.read_text(encoding='utf-8').splitlines()
    count, index = 0, 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line or line.startswith('#'):
            continue
        fields = line.split(maxsplit=9)
        if len(fields) != 10:
            raise ValueError('Неверный images.txt: ' + str(path))
        count += 1
        index += 1  # POINTS2D is a physical line and may be empty.
    return count


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Камеры COLMAP для приложения Ракурс. Оригиналы не изменяются.')
    parser.add_argument('--images', required=True, type=Path, help='Папка images из рабочего ZIP')
    parser.add_argument('--output', required=True, type=Path, help='Новая, ещё не существующая папка результата')
    parser.add_argument('--colmap', default='colmap', help='COLMAP на PATH или полный путь к исполняемому файлу')
    args = parser.parse_args(argv)
    images, output = args.images.resolve(), args.output.resolve()
    exe = shutil.which(args.colmap)
    if not exe:
        raise ValueError('COLMAP не найден. Установите его отдельно и передайте --colmap с полным путём.')
    if Path(exe).suffix.lower() in {'.bat', '.cmd'}:
        raise ValueError('Укажите непосредственно colmap.exe, а не BAT/CMD-обёртку.')
    if not images.is_dir() or len(list(images.glob('*.png'))) < 6:
        raise ValueError('В папке images должно быть не менее шести экспортированных PNG.')
    if output.exists():
        raise ValueError('Папка результата уже существует. Укажите новую папку, чтобы сохранить предыдущую попытку.')
    # Check compatibility before creating output. A user can inspect every executed command in the log.
    def help_for(command):
        r = subprocess.run([exe, command, '-h'], capture_output=True, text=True, encoding='utf-8', errors='replace')
        return r.stdout + r.stderr
    extraction_flag = gpu_flag(help_for('feature_extractor'), 'extract')
    matching_flag = gpu_flag(help_for('exhaustive_matcher'), 'match')
    output.mkdir(parents=True)
    sparse = output / 'sparse'
    sparse.mkdir()
    commands = []
    with (output / 'colmap.log').open('w', encoding='utf-8') as log:
        def run(arguments):
            command = [exe, *map(str, arguments)]
            commands.append(command)
            log.write('\nCOMMAND: ' + json.dumps(command, ensure_ascii=False) + '\n')
            log.flush()
            print('COLMAP:', arguments[0], flush=True)
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        database = output / 'database.db'
        run(['feature_extractor', '--database_path', database, '--image_path', images,
             '--ImageReader.camera_model', 'SIMPLE_RADIAL', '--ImageReader.single_camera', '1', extraction_flag, '0'])
        run(['exhaustive_matcher', '--database_path', database, matching_flag, '0'])
        run(['mapper', '--database_path', database, '--image_path', images, '--output_path', sparse])
        models = []
        for model in sorted(sparse.iterdir()):
            if not model.is_dir():
                continue
            text = output / ('text-model-' + model.name)
            text.mkdir()
            run(['model_converter', '--input_path', model, '--output_path', text, '--output_type', 'TXT'])
            models.append((registered_images(text / 'images.txt'), text))
    if not models:
        raise ValueError('COLMAP не восстановил связанную модель. Посмотрите colmap.log. Нужны текстура, перекрытие и неподвижность сцены.')
    count, chosen = max(models, key=lambda x: x[0])
    selected = output / 'selected'
    selected.mkdir()
    for name in ['cameras.txt', 'images.txt', 'points3D.txt']:
        if (chosen / name).exists():
            shutil.copyfile(chosen / name, selected / name)
    manifest = {'createdAt': datetime.now(timezone.utc).isoformat(), 'images': str(images),
                'registered': count, 'inputPNG': len(list(images.glob('*.png'))),
                'modelCount': len(models), 'selectedModel': chosen.name, 'commands': commands,
                'limitation': 'Disconnected models are not merged. Fixed-pose retrospective analysis only.'}
    (output / 'run.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Готово: зарегистрировано {count} кадров. Импортируйте cameras.txt и images.txt из {selected}')
    if len(models) > 1:
        print('Есть раздельные модели. Выбрана крупнейшая; их системы координат не объединялись.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print('Ошибка: ' + str(error), file=sys.stderr)
        sys.exit(1)
