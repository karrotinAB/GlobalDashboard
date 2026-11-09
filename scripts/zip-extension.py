# 확장 프로그램 폴더(extension/)를 public/gd-extension.zip 으로 묶음 → 사이트에서 내려받기
# 사용: python3 scripts/zip-extension.py  (extension/ 을 고친 뒤 실행)
import os, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'extension')
out = os.path.join(root, 'public', 'gd-extension.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(src)):
        z.write(os.path.join(src, name), os.path.join('2조-근태-보내기', name))
print('wrote', out)
