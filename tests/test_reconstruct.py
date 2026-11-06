import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('reconstruct', Path(__file__).parents[1] / 'tools' / 'reconstruct.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HelperTests(unittest.TestCase):
    def test_gpu_flags(self):
        self.assertEqual(helper.gpu_flag('--FeatureExtraction.use_gpu', 'extract'), '--FeatureExtraction.use_gpu')
        self.assertEqual(helper.gpu_flag('--SiftMatching.use_gpu', 'match'), '--SiftMatching.use_gpu')
        with self.assertRaises(ValueError):
            helper.gpu_flag('unrecognized version', 'extract')

    def test_empty_points_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'images.txt'
            path.write_text('# images\n1 1 0 0 0 0 0 0 1 a.png\n\n2 1 0 0 0 0 0 0 1 b.png\n1 2 3\n', encoding='utf-8')
            self.assertEqual(helper.registered_images(path), 2)

    def test_missing_colmap_is_explicit(self):
        with self.assertRaisesRegex(ValueError, 'COLMAP не найден'):
            helper.main(['--images', '.', '--output', 'never-created', '--colmap', 'missing-colmap-executable-for-test'])


if __name__ == '__main__':
    unittest.main()
