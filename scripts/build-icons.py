"""Dibuja el ícono de la aplicación.

Es lo que se ve en la pestaña del navegador, en el acceso directo del escritorio
y en la pantalla de inicio del celular cuando alguien agrega el juego. Son tres
tamaños muy distintos del mismo dibujo y cada uno tiene su exigencia: a 512 px se
mira, a 16 px se reconoce o no se reconoce. Por eso el ícono no es una captura
del juego —un kart fotografiado en la pista se convierte en una mancha marrón al
achicarlo— sino un dibujo con cuatro formas grandes y mucho contraste: la bandera
a cuadros, la carrocería roja, las dos gomas negras y el alerón amarillo.

Se dibuja al cuádruple y se reduce con filtro Lanczos: dibujar directo a 32 px da
bordes dentados, y un suavizado posterior no los arregla.

Uso: python3 scripts/build-icons.py
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# Tamaño de trabajo. Todo lo demás se expresa en fracciones de este número para
# que el dibujo no dependa de él.
S = 1024

NAVY_TOP = (26, 38, 68)
NAVY_BOTTOM = (8, 12, 24)
RED = (226, 58, 44)
RED_DARK = (168, 32, 24)
YELLOW = (255, 200, 48)
TIRE = (24, 26, 32)
TIRE_RIM = (210, 214, 224)
SKIN = (238, 196, 160)
HAIR = (74, 48, 36)
WHITE = (244, 246, 250)


def u(fraction: float) -> float:
    return fraction * S


def background() -> Image.Image:
    """Degradado vertical, de azul noche arriba a casi negro abajo."""
    img = Image.new("RGB", (1, S))
    px = img.load()
    for y in range(S):
        t = y / (S - 1)
        # Curva suave: con una interpolación lineal el degradado se ve en bandas
        # justo en el medio, que es donde está el kart.
        t = t * t * (3 - 2 * t)
        px[0, y] = tuple(
            round(NAVY_TOP[i] + (NAVY_BOTTOM[i] - NAVY_TOP[i]) * t) for i in range(3)
        )
    return img.resize((S, S), Image.BICUBIC)


def glow(img: Image.Image) -> None:
    """Halo cálido detrás del kart, para despegarlo del fondo."""
    layer = Image.new("L", (S, S), 0)
    ImageDraw.Draw(layer).ellipse(
        [u(0.14), u(0.20), u(0.86), u(0.86)], fill=120
    )
    layer = layer.filter(ImageFilter.GaussianBlur(S * 0.12))
    img.paste(Image.new("RGB", (S, S), (70, 110, 180)), (0, 0), layer)


def checkers(draw: ImageDraw.ImageDraw) -> None:
    """Banda a cuadros al pie: es lo que dice "carrera" sin leer nada."""
    top = u(0.845)
    cell = S / 10
    high = u(0.078)
    for row in range(2):
        y = top + row * high
        for col in range(10):
            if (col + row) % 2:
                continue
            x = col * cell
            draw.rectangle([x, y, x + cell, y + high], fill=WHITE)


def kart(draw: ImageDraw.ImageDraw) -> None:
    """Kart de frente.

    De frente y no de perfil porque de frente es simétrico, y la simetría es lo
    que sobrevive a la reducción: un perfil a 16 px se lee como una mancha con un
    lado más pesado que el otro.
    """
    # Gomas.
    for x0, x1 in ((0.055, 0.265), (0.735, 0.945)):
        draw.rounded_rectangle(
            [u(x0), u(0.485), u(x1), u(0.775)], radius=u(0.058), fill=TIRE
        )
        draw.ellipse(
            [u(x0 + 0.048), u(0.575), u(x1 - 0.048), u(0.685)], fill=TIRE_RIM
        )

    # Alerón, asomando por detrás del piloto.
    draw.rounded_rectangle(
        [u(0.185), u(0.375), u(0.815), u(0.445)], radius=u(0.026), fill=YELLOW
    )

    # Carrocería.
    draw.rounded_rectangle(
        [u(0.225), u(0.425), u(0.775), u(0.765)], radius=u(0.075), fill=RED
    )
    # Sombra interna abajo: le da volumen sin dibujar un degradado.
    draw.rounded_rectangle(
        [u(0.225), u(0.655), u(0.775), u(0.765)], radius=u(0.062), fill=RED_DARK
    )
    # Chapa del número.
    draw.rounded_rectangle(
        [u(0.375), u(0.650), u(0.625), u(0.755)], radius=u(0.026), fill=WHITE
    )

    # Piloto: cabeza grande, estilo del juego.
    head = [u(0.345), u(0.115), u(0.655), u(0.425)]
    draw.ellipse(head, fill=SKIN)
    # Pelo: media luna sobre la cabeza.
    draw.pieslice(head, start=184, end=356, fill=HAIR)
    # Ojos y sonrisa. Sin ellos la cara queda en blanco, que a tamaño grande se
    # ve raro; a 16 px desaparecen y no molestan.
    for cx in (0.437, 0.563):
        draw.ellipse(
            [u(cx - 0.030), u(0.272), u(cx + 0.030), u(0.330)], fill=(44, 34, 30)
        )
    draw.arc(
        [u(0.435), u(0.300), u(0.565), u(0.398)],
        start=20,
        end=160,
        fill=(140, 82, 62),
        width=int(u(0.018)),
    )


def rounded(img: Image.Image, radius: float) -> Image.Image:
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def build() -> Image.Image:
    img = background()
    glow(img)
    draw = ImageDraw.Draw(img)
    checkers(draw)
    kart(draw)
    return img


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    flat = build()

    # Cuadrado completo: lo pide Android para poder recortarlo con la forma que
    # use el sistema, y iOS redondea solo. Un PNG ya redondeado se ve con un
    # marco oscuro alrededor en la pantalla de inicio.
    for size in (192, 512):
        flat.resize((size, size), Image.LANCZOS).save(PUBLIC / f"icono-{size}.png")
    flat.resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")

    # En la pestaña el ícono va suelto sobre el fondo del navegador: ahí sí
    # conviene redondeado, porque un cuadrado perfecto se ve como un error.
    soft = rounded(flat, S * 0.22)
    soft.resize((64, 64), Image.LANCZOS).save(
        PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )

    print("public/: icono-192.png, icono-512.png, apple-touch-icon.png, favicon.ico")


if __name__ == "__main__":
    main()
