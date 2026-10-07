#!/usr/bin/env python3
"""
Recorta a las seis personas de sus fotos y las deja con acabado de afiche.

Esto NO es lo que se ve manejando. Es la portada: el juego se presenta con las
caras reales de la familia, recortadas del fondo y tratadas como se trata un
cartel de película —contraste alto, sombras frías, luz de contorno, viñeta—, y
recién después entran los personajes 3D. Son dos piezas distintas a propósito:
la del juego tiene que leerse a cuarenta metros y en movimiento, la de la
portada tiene que hacer que alguien quiera jugar.

El recorte lo hace una red de segmentación (rembg / u2net), que es lo único que
separa bien el pelo del fondo; con umbral de color o GrabCut, los rulos de Isma
y las mechas de Vero salen comidos y se nota enseguida que es un recorte.

El encuadre sale de los mismos 68 landmarks que usa la cara del juego, así que
las seis cabezas quedan del mismo tamaño y a la misma altura aunque las fotos
estén sacadas a distancias muy distintas. Puestas en fila, eso es la diferencia
entre un reparto y seis fotos pegadas.

Salida: `src/ui/portraits.ts`.

Uso: python3 scripts/landmarks.py && python3 scripts/build-portraits.py
"""

import base64
import io
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

W, H = 620, 860

# Dónde van los ojos en el afiche. Manda el encuadre de las seis: con la
# distancia entre pupilas fijada, las seis cabezas salen del mismo tamaño y a la
# misma altura por más que las fotos estén sacadas a distancias distintas, que
# es lo que hace que se lean como un reparto y no como seis fotos pegadas.
# Encuadre cerrado, de busto: en un afiche lo que vende es la cara.
EYE_Y = 322
EYE_SPAN = 124

# Luz de contorno: de qué lado entra y de qué color. Es el recurso que más
# "afiche" agrega por lo poco que cuesta — despega a la persona del fondo sin
# tener que iluminarla de verdad.
RIM_COLOR = (150, 205, 255)
RIM_SIDE = -1          # -1 entra por la izquierda, +1 por la derecha
RIM_WIDTH = 13

# Graduación de color. Sombras hacia el azul, luces hacia el ámbar: es el
# contraste de temperatura de casi cualquier afiche de acción, y funciona porque
# separa a la persona (cálida) del fondo (frío).
SHADOW_TINT = (-10, -2, 20)
HIGHLIGHT_TINT = (16, 6, -12)


def transform_for(eyes):
    """Misma alineación por pupilas que la cara del juego, a medida de afiche."""
    (lx, ly), (rx, ry) = eyes
    angle = math.atan2(ry - ly, rx - lx)
    span = math.hypot(rx - lx, ry - ly)
    scale = EYE_SPAN / span
    cx, cy = (lx + rx) / 2, (ly + ry) / 2
    tx, ty = W / 2, EYE_Y

    cos_a, sin_a = math.cos(angle), math.sin(angle)
    k = 1.0 / scale
    a, b = k * cos_a, -k * sin_a
    d, e = k * sin_a, k * cos_a
    return (a, b, cx - a * tx - b * ty, d, e, cy - d * tx - e * ty)


def cutout(path: str, session) -> Image.Image:
    """La persona sola, sin fondo."""
    from rembg import remove

    with open(path, "rb") as fh:
        data = remove(fh.read(), session=session)
    img = Image.open(io.BytesIO(data)).convert("RGBA")

    # La red no deja el fondo en cero: deja valores muy bajos, de dos o tres
    # sobre 255. A simple vista es invisible, pero la graduación de después le
    # levanta las sombras hacia el azul y eso sí se ve: el rectángulo entero de
    # la foto original aparece como una mancha apenas más clara que el afiche,
    # con sus cuatro esquinas rectas. Así que el fondo se lleva a cero de una
    # vez, y de paso se endurece el borde para que no quede un halo.
    px = np.array(img)
    a = px[:, :, 3].astype(np.float32)
    a = np.clip((a - 26) * (255 / (255 - 26 - 18)), 0, 255)
    px[:, :, 3] = a.astype(np.uint8)
    return Image.fromarray(px)


def graded(img: Image.Image) -> Image.Image:
    """
    El tratamiento de afiche.

    Tres cosas, en este orden: primero la curva de contraste, que hunde las
    sombras y sube las luces; después el tinte partido, frío abajo y cálido
    arriba; y al final la saturación, que sube apenas. Invertir el orden da un
    resultado distinto y peor: si se satura antes de la curva, el contraste
    después empuja los colores ya saturados fuera de rango y las mejillas se
    queman en rojo plano.
    """
    px = np.array(img.convert("RGBA"), dtype=np.float32)
    rgb, alpha = px[:, :, :3] / 255.0, px[:, :, 3:]

    # Curva en S suave.
    rgb = np.clip(rgb, 0, 1)
    rgb = rgb * rgb * (3 - 2 * rgb) * 0.34 + rgb * 0.66

    # Tinte partido según la luminosidad de cada píxel.
    lum = (rgb * np.array([0.299, 0.587, 0.114])).sum(axis=2, keepdims=True)
    shadow = np.array(SHADOW_TINT, dtype=np.float32) / 255.0
    highlight = np.array(HIGHLIGHT_TINT, dtype=np.float32) / 255.0
    rgb = rgb + shadow * (1 - lum) + highlight * lum

    out = Image.fromarray(
        np.concatenate([np.clip(rgb, 0, 1) * 255, alpha], axis=2).astype(np.uint8)
    )
    return ImageEnhance.Color(out).enhance(1.12)


def rim_light(img: Image.Image) -> Image.Image:
    """
    Luz de contorno: un filo encendido del lado de donde viene la luz.

    Se saca del propio recorte. La silueta se corre unos píxeles hacia un
    costado; lo que queda cuando se le resta la silueta original es exactamente
    la franja del borde de ese lado. Difuminada y sumada en modo pantalla, esa
    franja es la luz que roza el pelo y el hombro, y es lo que despega a la
    persona del fondo oscuro sin tener que montar una iluminación.
    """
    alpha = np.array(img.split()[3], dtype=np.float32) / 255.0

    shifted = np.roll(alpha, RIM_SIDE * RIM_WIDTH, axis=1)
    if RIM_SIDE < 0:
        shifted[:, -RIM_WIDTH:] = 0
    else:
        shifted[:, :RIM_WIDTH] = 0

    edge = np.clip(alpha - shifted, 0, 1)
    edge = np.array(
        Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4)),
        dtype=np.float32,
    ) / 255.0
    # Sólo donde hay persona: si no, el filo se dibuja sobre el fondo.
    edge = edge * alpha

    px = np.array(img, dtype=np.float32)
    glow = np.array(RIM_COLOR, dtype=np.float32)[None, None, :] * edge[:, :, None]
    # Pantalla: aclara sin ensuciar el color que ya estaba.
    px[:, :, :3] = 255 - (255 - px[:, :, :3]) * (255 - glow) / 255
    return Image.fromarray(np.clip(px, 0, 255).astype(np.uint8))


def fade_photo_edge(img: Image.Image, photo_size, coeffs, inset=20, feather=44) -> Image.Image:
    """
    Suaviza el borde donde se termina la FOTO, no donde se termina la persona.

    La red recorta a la persona del fondo, pero no puede inventar lo que la foto
    no tiene: en varias, el encuadre corta al chico por el hombro o por el brazo,
    y ahí el recorte termina en una línea perfectamente recta. Sobre el afiche
    oscuro eso se ve como un rectángulo pegado alrededor de cada uno, que es
    justo el efecto que arruina un recorte por más bueno que sea.

    Para saber dónde cae ese borde se pasa por la misma transformación una
    imagen toda blanca del tamaño de la foto: lo que llega blanco es lo que la
    foto cubre, y el degradado del límite es exactamente el borde a difuminar.
    """
    valid = Image.new("L", photo_size, 255).transform(
        img.size, Image.AFFINE, coeffs, resample=Image.BILINEAR
    )
    # Meterse un poco hacia adentro antes de difuminar: si no, el degradado
    # empieza recién en el filo y el filo sigue viéndose.
    valid = valid.filter(ImageFilter.GaussianBlur(inset * 0.5)).point(
        lambda v: 255 if v > 232 else 0
    ).filter(ImageFilter.GaussianBlur(feather))

    px = np.array(img)
    px[:, :, 3] = (px[:, :, 3].astype(np.float32) * (np.array(valid, dtype=np.float32) / 255.0)).astype(np.uint8)
    return Image.fromarray(px)


def fade_bottom(img: Image.Image, start=0.72) -> Image.Image:
    """
    El pie del retrato se desvanece en vez de cortarse.

    Un recorte que termina en una línea recta a la altura del pecho se lee como
    lo que es, una foto recortada. Desvanecido, el personaje parece salir de la
    oscuridad del afiche, y de paso deja lugar para el nombre debajo.
    """
    alpha = np.array(img.split()[3], dtype=np.float32)
    ramp = np.ones(img.height, dtype=np.float32)
    lo = int(img.height * start)
    ramp[lo:] = np.linspace(1, 0, img.height - lo) ** 1.4
    alpha *= ramp[:, None]

    px = np.array(img)
    px[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(px)


def encode(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=90, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    from rembg import new_session

    session = new_session("u2net")
    with open("scripts/landmarks.json") as fh:
        marks = json.load(fh)

    portraits = {}
    sheet = []

    for cid, info in marks.items():
        person = cutout(f"fotos/{cid}.jpg", session)
        coeffs = transform_for((info["leftEye"], info["rightEye"]))
        framed = person.transform((W, H), Image.AFFINE, coeffs, resample=Image.BICUBIC)
        framed = fade_photo_edge(framed, person.size, coeffs)
        art = fade_bottom(rim_light(graded(framed)))
        portraits[cid] = encode(art)
        sheet.append(art)
        print(f"{cid}: {len(portraits[cid]) // 1024} KB")

    header = '''/**
 * Retratos de la portada: las seis personas reales, recortadas de sus fotos.
 *
 * Generado por `scripts/build-portraits.py`. No editar a mano.
 *
 * Son la pieza de venta del juego y NO son lo que se ve manejando: ahí van los
 * personajes 3D. Acá las fotos van tratadas como un afiche —contraste alto,
 * sombras frías, luz de contorno y el pie desvanecido— y encuadradas por las
 * pupilas, para que las seis cabezas queden del mismo tamaño y a la misma
 * altura aunque las fotos originales no se parezcan en nada.
 */

'''
    with open("src/ui/portraits.ts", "w") as fh:
        fh.write(header)
        fh.write(f"export const POSTER_PORTRAITS: Record<string, string> = {json.dumps(portraits, indent=2)};\n")
    print("src/ui/portraits.ts escrito")

    scratch = os.environ.get("SCRATCH")
    if scratch:
        board = Image.new("RGB", (W * len(sheet), H), (14, 17, 24))
        for i, im in enumerate(sheet):
            board.paste(im, (i * W, 0), im)
        board.save(f"{scratch}/afiche.png")
        print(f"hoja de control en {scratch}/afiche.png")


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    main()
