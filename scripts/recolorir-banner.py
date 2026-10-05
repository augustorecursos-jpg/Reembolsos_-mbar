# Recolore a arte original do banner (laranja) para o verde-azulado do portal, sem alterar a pessoa.
# Uso: pip install pillow numpy && python3 scripts/recolorir-banner.py (ajuste o caminho da imagem original abaixo).
import numpy as np
from PIL import Image, ImageDraw
im = Image.open('/tmp/claude-0/-home-user/ccd6eeba-dbc0-5349-af0e-ad4429d7c548/images/4.webp').convert('RGB')
rgb = np.array(im).astype(np.float32)
hsv = np.array(im.convert('HSV')).astype(np.float32)
H, S, V = hsv[...,0]*360/255, hsv[...,1]/255, hsv[...,2]/255
h, w = H.shape
yy, xx = np.mgrid[0:h, 0:w]
laranja = (H >= 4) & (H <= 45)

def poligono(pontos):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).polygon(pontos, fill=1); return np.array(m).astype(bool)
def faixa(pontos, larg):
    m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).line(pontos, fill=1, width=larg); return np.array(m).astype(bool)

# Onda de baixo (degradê marinho → laranja), limitada pela curva da borda.
onda = poligono([(560, 805), (600, 800), (700, 797), (800, 805), (880, 825), (950, 860), (1000, 900), (1036, 941), (560, 941)])
# Traço fino no canto superior direito, seguindo a linha.
traco = faixa([(1500, 0), (1511, 20), (1524, 40), (1540, 60), (1557, 80), (1573, 100), (1588, 120), (1601, 140), (1611, 160), (1625, 190), (1635, 220), (1641, 240), (1645, 260), (1648, 300), (1649, 340), (1647, 362)], 12)
icones = ((xx >= 780) & (xx <= 1000) & (yy >= 105) & (yy <= 300)) | \
         ((xx >= 985) & (xx <= 1115) & (yy >= 255) & (yy <= 380)) | \
         ((xx >= 1030) & (xx <= 1205) & (yy >= 395) & (yy <= 560)) | \
         ((xx >= 890) & (xx <= 1160) & (yy >= 160) & (yy <= 500))

# Abaixo do notebook há a mesa de madeira: ali só a onda da esquerda (x < 640) é trocada.
m_esq = (xx < 1000) & ((yy < 740) | (xx < 640)) & ~onda & laranja & (S > 0.25) & (V > 0.2)
m_ico = icones & laranja & (S > 0.45) & (V > 0.62)
m_tra = traco & laranja & (S > 0.3) & (V > 0.4)
mask = m_esq | m_ico | m_tra

# Troca por matiz (texto, ícones, onda da esquerda, traço).
H2 = np.where(mask, 176.0, H)
S2 = np.where(mask, np.minimum(S, 0.9) * 0.92, S)
V2 = np.where(mask, V * 0.8, V)
out = np.array(Image.fromarray(np.stack([H2/360*255, S2*255, V2*255], -1).clip(0, 255).astype(np.uint8), 'HSV').convert('RGB')).astype(np.float32)

# Na onda de baixo: cada pixel é uma mistura de marinho e laranja; troca só a parte laranja pelo verde-azulado.
N = np.array([16, 45, 92], np.float32); O = np.array([243, 118, 38], np.float32); T = np.array([24, 168, 158], np.float32)
d = O - N
a = (((rgb - N) * d).sum(-1) / (d * d).sum()).clip(0, 1)[..., None]
mistura = rgb + a * (T - O)
out = np.where(onda[..., None], mistura, out)

res = Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGB')
res.save('banner-teal.png')
res.save('banner-teal.webp', quality=84, method=6)
res.resize((960, 540), Image.LANCZOS).save('banner-teal-960.webp', quality=82, method=6)
res.crop((600, 700, 1250, 941)).save('zoom-baixo.png'); res.crop((1380, 0, 1672, 420)).save('zoom-traco.png')
print('ok')
