"""Prepara la firma del autor para el pie de la portada.

El logo viene como una tarjeta: letras claras sobre un rectángulo azul noche.
Puesto tal cual sobre el afiche quedaría un recuadro pegado encima de la imagen,
que es justo lo que se nota. Acá se le saca el fondo —el azul se vuelve
transparente y las letras conservan su color y sus bordes suavizados— y queda
sólo la marca, que se apoya sobre el afiche como si estuviera impresa ahí.

El resultado va embebido en `src/ui/brand.ts` y no como archivo suelto, igual que
el resto de las imágenes del juego: así la portada no depende de una segunda
descarga que puede llegar tarde y aparecer de golpe cuando el afiche ya se vio.

Uso: python3 scripts/build-brand.py
"""

from __future__ import annotations

import base64
import io
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "marca" / "fernando-marquez.png"
OUT = ROOT / "src" / "ui" / "brand.ts"

# Color de fondo de la tarjeta original.
CARD = np.array([15, 23, 42])
# Hasta dónde se considera fondo. Por debajo de este margen el píxel se vuelve
# transparente; entre este valor y el doble, va quedando opaco de a poco, que es
# lo que conserva los bordes suaves de las letras.
TOLERANCE = 26.0
# Ancho final. El pie se ve chico, pero se mira en pantallas de mucha densidad:
# al doble del tamaño en que se muestra, las letras quedan nítidas.
WIDTH = 560


def main() -> None:
    img = Image.open(SOURCE).convert("RGBA")
    rgb = np.array(img)[:, :, :3].astype(np.float32)

    # El fondo son dos cosas, no una: el azul de la tarjeta y el negro de las
    # esquinas, que quedan afuera del rectángulo redondeado. Tomando sólo el azul
    # las cuatro esquinas sobreviven como manchas negras, que sobre el afiche se
    # ven como suciedad alrededor de la firma.
    to_card = np.abs(rgb - CARD).sum(axis=2)
    to_black = rgb.sum(axis=2)
    distance = np.minimum(to_card, to_black)
    alpha = np.clip((distance - TOLERANCE) / TOLERANCE, 0.0, 1.0)

    out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    cut = Image.fromarray(out, "RGBA")

    box = cut.getbbox()
    if box is None:
        raise SystemExit("El logo quedó vacío: revisá CARD y TOLERANCE")
    cut = cut.crop(box)

    height = round(cut.height * WIDTH / cut.width)
    cut = cut.resize((WIDTH, height), Image.LANCZOS)

    buffer = io.BytesIO()
    cut.save(buffer, format="WEBP", quality=92, method=6)
    data = base64.b64encode(buffer.getvalue()).decode()

    OUT.write_text(
        "/**\n"
        " * Firma del autor para el pie de la portada.\n"
        " *\n"
        " * Generado por `scripts/build-brand.py` desde `marca/`. No editar a mano.\n"
        " */\n\n"
        f"export const AUTHOR_MARK = 'data:image/webp;base64,{data}';\n"
        f"\n/** Proporción del logo, para reservarle el alto exacto y que no salte. */\n"
        f"export const AUTHOR_MARK_RATIO = {cut.width / cut.height:.4f};\n",
        encoding="utf8",
    )
    print(f"src/ui/brand.ts — {cut.width}×{cut.height}, {len(data) / 1024:.0f} kB")


if __name__ == "__main__":
    main()
