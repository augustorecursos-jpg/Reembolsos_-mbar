# Gera a foto da home: apaga as letras "OS" que sobram no recorte e recorta o lado direito da arte (pessoa + ícones).
# Uso: rode antes scripts/recolorir-banner.py; depois pip install scipy && python3 scripts/recortar-foto-hero.py
import numpy as np
from PIL import Image
from scipy import ndimage
im = Image.open('banner-teal.png').convert('RGB')
rgb = np.array(im).astype(np.float32)
hsv = np.array(im.convert('HSV')).astype(np.float32)
H, S, V = hsv[...,0]*360/255, hsv[...,1]/255, hsv[...,2]/255
y0, y1, x0, x1 = 392, 504, 690, 940
caixa = np.zeros(H.shape, bool); caixa[y0:y1, x0:x1] = True
teal = caixa & (H >= 150) & (H <= 200) & (S > 0.18) & (V > 0.3)
rot, n = ndimage.label(teal)
areas = ndimage.sum(teal, rot, range(1, n + 1))
letras = np.isin(rot, [i + 1 for i, a in enumerate(areas) if a > 400])   # traços são pequenos; letras são grandes
letras = ndimage.binary_dilation(letras, iterations=3) & caixa
print('componentes', n, 'letras', int((areas > 400).sum()), 'pixels', int(letras.sum()))
# Preenche cada coluna interpolando o fundo entre a linha de cima e a de baixo da caixa.
out = rgb.copy()
for x in range(x0, x1):
    col = letras[y0:y1, x]
    if not col.any(): continue
    topo, base = rgb[y0 - 2, x], rgb[y1 + 1, x]
    for i, y in enumerate(range(y0, y1)):
        if col[i]:
            t = i / (y1 - y0)
            out[y, x] = topo * (1 - t) + base * t
# Suaviza levemente a área preenchida para não ficar “listrada”.
suave = ndimage.uniform_filter(out, size=(5, 5, 1))
out = np.where(letras[..., None], suave, out)
res = Image.fromarray(out.clip(0, 255).astype(np.uint8))
res.save('banner-teal-limpo.png')
res.crop((700, 280, 1060, 560)).resize((720, 560)).save('zoom-os-limpo.png')
f = res.crop((740, 0, 1672, 941))
f.save('foto-hero.webp', quality=84, method=6)
f.resize((620, 626), Image.LANCZOS).save('foto-hero-620.webp', quality=82, method=6)
