#!/usr/bin/env python3
"""
Convierte las fotos de `fotos/` en las texturas que usa el juego.

Genera dos cosas por personaje:

- `face`    — el rostro recortado por su CONTORNO REAL, alineado para que los
              ojos caigan exactamente donde los espera el casquete de la cara
              del modelo 3D. Es lo que reemplaza a la cara dibujada.
- `retrato` — un recorte más amplio, con pelo y hombros. Es lo que se ve en la
              presentación y en la tarjeta del menú.

Todo sale de `scripts/landmarks.json` (68 puntos por cara, generados con
`scripts/landmarks.py`). Antes las pupilas se leían a mano sobre una grilla y
el recorte era una forma fija y simétrica; las dos cosas fallaban:

- a mano el ojo más lejano de una cara girada se lee corrido, y ese error se
  multiplica por la escala hasta mover la cara media frente;
- una máscara simétrica sobre una cara de tres cuartos sobra de un lado (entra
  fondo) y falta del otro (corta el pómulo).

Con los 68 puntos el alineado sale de las pupilas medidas y el recorte sigue la
mandíbula de cada cara, así que las caras giradas de Benja y Vero se recortan
igual de limpias que las de frente.

Salida: `src/characters/photos.ts`, con las imágenes en base64. Van embebidas y
no como archivos sueltos porque el juego se publica como un único HTML.

Uso: python3 scripts/landmarks.py && python3 scripts/build-photos.py
"""

import base64
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frontalize

SIZE = 512

# Dónde tienen que quedar los ojos en la textura de la cara.
#
# La separación no se elige por gusto. Salen de dos cosas que tienen que cerrar
# juntas: la proporción de una cara real —el mentón cae a ~1,63 veces la
# distancia entre pupilas por debajo de los ojos, y la mandíbula abre ~2,2 veces
# esa distancia— y el trozo de esfera al que se pega esta textura, que ahora da
# la vuelta hasta las orejas y baja hasta debajo del mentón.
#
# Como el casquete cubre mucha más cabeza que antes, el rostro tiene que ocupar
# MENOS de la textura, no más: el resto de la lámina es la mejilla doblando
# hacia la oreja y la frente subiendo a la coronilla. Ese aire no es relleno, es
# cabeza, y por eso se completa estirando la piel del borde.
FACE_EYE_Y = 232
FACE_EYE_SPAN = 118

# El retrato va más lejos: entra la cabeza entera y los hombros.
PORTRAIT_EYE_Y = 210
PORTRAIT_EYE_SPAN = 104

# Los landmarks ya vienen en coordenadas de la textura, así que las funciones
# que esperan una transformación reciben ésta, que no hace nada.
def IDENTITY(p):
    return (p[0], p[1])


JAW = list(range(0, 17))
BROWS = list(range(17, 27))

# Ajuste fino a mano, por si alguna foto queda fuera de lugar después del
# balance automático. Normalmente vacío.
TONE: dict = {}

# Piel de referencia a la que se acercan las seis fotos. No es el color que va a
# tener nadie: sólo marca la DIRECCIÓN del balance, y cada cara conserva su
# propia luminosidad.
REFERENCE_SKIN = (228, 178, 152)

# Cuánto se corrige. 1.0 dejaría a los seis del mismo color, que es peor: se
# pierde que Fer es más tostado y Benja más claro. Con estos valores se va el
# tinte de la lámpara y queda la piel de la persona.
BALANCE_COLOR = 0.85
BALANCE_LIGHT = 0.45


EVEN_LIGHTING = 0.50


def even_lighting(img: Image.Image, strength: float = EVEN_LIGHTING) -> Image.Image:
    """
    Saca la luz del ambiente y deja la forma de la cara.

    En una cara conviven dos cosas muy distintas metidas en los mismos píxeles.
    Una es la luz de ese día: de dónde venía la lámpara, qué mitad quedó en
    sombra, el reflejo de la ventana. La otra es el relieve del rostro: la
    sombrita bajo la nariz, el hueco de la cuenca del ojo, el borde del labio.
    La primera es de la foto y estorba —Isma tiene una diagonal de sombra que le
    cruza media cara, Vero un brillo de ventana sobre la sien— y la segunda es la
    persona y hay que dejarla intacta.

    Se separan por tamaño, que es lo único que las distingue de verdad: la luz
    del ambiente varía lentamente a lo largo de toda la cara, el relieve varía
    en pocos píxeles. Así que se desenfoca muchísimo la luminosidad —queda sólo
    el degradado grande, sin ningún rasgo— y se divide la imagen por él. Lo
    lento se cancela, lo rápido queda.

    No va al 100%: una cara con la iluminación completamente plana se ve
    recortada de un catálogo y pierde el volumen. Va lo suficiente como para que
    las seis parezcan sacadas el mismo día.
    """
    px = np.array(img.convert("RGB"), dtype=np.float32)
    lum = px @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

    base = np.array(
        Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8))
        .filter(ImageFilter.GaussianBlur(SIZE / 7.0)),
        dtype=np.float32,
    )
    gain = np.median(base) / np.maximum(base, 8.0)
    gain = 1.0 + (gain - 1.0) * strength
    return Image.fromarray(np.clip(px * gain[:, :, None], 0, 255).astype(np.uint8))


def balance(img: Image.Image, mask: Image.Image) -> Image.Image:
    """
    Iguala la luz de las seis fotos sin igualar a las seis personas.

    Las fotos vienen de celulares distintos y de luces distintas: Isma bajo una
    lámpara que le mete un naranja fuerte, Vero contra la ventana del auto que le
    lava la cara, Xavi a la sombra. Puestos uno al lado del otro en el menú, o en
    la misma pista, se ve que cada uno viene de otro lado antes de que uno
    alcance a mirarles la cara — y eso es lo que hace que un juego parezca
    hecho de recortes.

    La corrección separa dos cosas que suelen ir juntas y no son lo mismo: el
    TINTE de la luz, que es del ambiente y hay que sacarlo, y la LUMINOSIDAD de
    la piel, que es de la persona y hay que dejarla. Así que se mide la mediana
    de la piel, se la lleva hacia el matiz de referencia conservando su propio
    brillo, y recién ahí se acercan los brillos entre sí, apenas.

    Todo se mide sólo dentro de la máscara: el fondo de la foto —una pared, el
    pasto, el tapizado del auto— no tiene por qué opinar sobre el color de la
    cara.
    """
    px = np.array(img.convert("RGB"), dtype=np.float32)
    core = np.array(mask) > 200
    if core.sum() < 200:
        return img

    def lum(c):
        return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

    med = np.median(px[core], axis=0)
    med_l = max(lum(med), 1.0)
    ref_l = lum(REFERENCE_SKIN)

    # Matiz: llevar la mediana al color de referencia con SU propio brillo.
    want = np.array(REFERENCE_SKIN, dtype=np.float32) * (med_l / ref_l)
    gain = np.clip(want / np.maximum(med, 1.0), 0.75, 1.35)
    gain = 1.0 + (gain - 1.0) * BALANCE_COLOR

    # Brillo: acercar la mediana al nivel común, mucho más suave.
    target_l = 168.0
    lift = 1.0 + ((target_l / med_l) - 1.0) * BALANCE_LIGHT
    lift = float(np.clip(lift, 0.82, 1.28))

    return Image.fromarray(np.clip(px * gain * lift, 0, 255).astype(np.uint8))


def transform_for(eyes, eye_y: int, eye_span: int):
    """
    Matriz afín que lleva la foto a la textura, y su inversa para PIL.

    Devuelve `(coeffs, forward)`: `coeffs` es lo que espera `Image.transform`
    (que aplica destino → origen) y `forward` lleva un punto de la foto a su
    lugar en la textura, que es lo que hace falta para recortar por los
    landmarks.

    El signo de la rotación importa y no es obvio: `Image.transform` recibe la
    INVERSA, así que la matriz que se le pasa rota +A mientras la imagen gira
    -A. Escribirla con el signo cambiado no rompe nada en una foto derecha —
    sólo en las torcidas, donde en lugar de enderezar la cara le duplica la
    inclinación.
    """
    (lx, ly), (rx, ry) = eyes
    angle = math.atan2(ry - ly, rx - lx)
    span = math.hypot(rx - lx, ry - ly)
    scale = eye_span / span
    cx, cy = (lx + rx) / 2, (ly + ry) / 2
    tx, ty = SIZE / 2, eye_y

    cos_a, sin_a = math.cos(angle), math.sin(angle)
    k = 1.0 / scale

    # destino → origen (lo que consume PIL)
    a, b = k * cos_a, -k * sin_a
    d, e = k * sin_a, k * cos_a
    coeffs = (a, b, cx - a * tx - b * ty, d, e, cy - d * tx - e * ty)

    def forward(pt):
        dx, dy = pt[0] - cx, pt[1] - cy
        return (
            scale * (cos_a * dx + sin_a * dy) + tx,
            scale * (-sin_a * dx + cos_a * dy) + ty,
        )

    return coeffs, forward


def aligned(photo: Image.Image, coeffs) -> Image.Image:
    """Una sola transformación afín: rotar, escalar y recortar de una vez.

    Encadenar crop→rotate→resize acumula recortes y remuestreos, y en una foto
    de celular eso se nota en los bordes.
    """
    return photo.transform((SIZE, SIZE), Image.AFFINE, coeffs, resample=Image.BICUBIC)


def bezier(points, steps=20):
    """Curva de Bézier cúbica, muestreada en puntos."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = points
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
            u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
        ))
    return out


def contour_mask(points, forward, inset: int = 11, feather: int = 9) -> Image.Image:
    """
    Máscara con el contorno REAL de esta cara.

    Abajo sigue la mandíbula punto por punto (landmarks 0..16), así que en una
    cara de tres cuartos el borde se ajusta solo: del lado que se aleja la
    mandíbula está más adentro y la máscara también.

    Arriba no hay landmarks —el 68 no marca el nacimiento del pelo— así que el
    borde superior se construye: se arquea sobre las cejas hasta donde empieza
    el pelo, a una altura proporcional a la separación entre pupilas, que es la
    única medida que se mantiene estable entre caras de chicos y de adultos.

    El contorno se mete unos píxeles hacia adentro antes de difuminar, y esa
    sangría no es un detalle: el borde que devuelve el detector pasa JUSTO por el
    filo de la cara, donde el píxel ya es mitad piel y mitad lo que haya detrás.
    Sin sangría esos píxeles sucios entran en la máscara, y como después la piel
    del borde se estira hacia afuera para rellenar el resto de la textura, la
    suciedad no se queda en el borde: se propaga. Así aparecían la remera azul de
    Benja sobre el cuello y los mechones de pelo de Vero desparramados sobre la
    sien. Con la sangría el borde arranca en piel limpia y no hay nada sucio que
    propagar.
    """
    jaw = [forward(points[i]) for i in JAW]
    brows = [forward(points[i]) for i in BROWS]

    e = FACE_EYE_SPAN

    # El tercio de abajo se recoge un 7% hacia la línea de los ojos. En varias
    # fotos el mentón toca directamente la ropa —Benja está sacado desde abajo y
    # no se le ve nada de cuello— así que el borde del detector pasa por la
    # remera y no por piel. Recortar ahí cuesta poco: el mentón lo pone la
    # cabeza 3D, y el parecido vive en los ojos, la nariz y la boca, que quedan
    # muy por encima de este recorte.
    jaw = [(x, FACE_EYE_Y + (y - FACE_EYE_Y) * 0.93) for x, y in jaw]

    brow_y = min(y for _, y in brows)
    top = brow_y - 0.52 * e              # nacimiento del pelo
    left, right = jaw[0], jaw[-1]

    # Arco de la frente: de una sien a la otra, pasando por la coronilla.
    forehead = (
        bezier([left, (left[0] + 0.06 * e, top + 0.10 * e),
                (SIZE / 2 - 0.30 * e, top), (SIZE / 2, top)])
        + bezier([(SIZE / 2, top), (SIZE / 2 + 0.30 * e, top),
                  (right[0] - 0.06 * e, top + 0.10 * e), right])
    )

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).polygon(jaw + list(reversed(forehead)), fill=255)

    # Sangría real en píxeles (no un escalado del polígono, que en una cara
    # alargada se come mucho más del mentón que de los costados).
    if inset > 0:
        mask = mask.filter(ImageFilter.MinFilter(3)) if inset < 2 else \
            mask.filter(ImageFilter.GaussianBlur(inset * 0.6)).point(
                lambda v: 255 if v > 216 else 0)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def jaw_mask(points, forward) -> Image.Image:
    """Sólo la piel de la cara, sin difuminar. Sirve para medir sobre ella."""
    jaw = [forward(points[i]) for i in JAW]
    brows = [forward(points[i]) for i in BROWS]
    brow_y = min(y for _, y in brows)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).polygon(
        jaw + [(x, brow_y) for x, _ in reversed(jaw)], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(6)).point(lambda v: 255 if v > 200 else 0)


def portrait_mask(points, forward, feather: int = 20) -> Image.Image:
    """
    Recorte del retrato: cabeza entera con pelo y hombros.

    Acá sí conviene un óvalo, pero centrado y dimensionado a partir de la cara
    detectada en vez de a ojo, para que las seis fotos entren igual de altas
    aunque estén sacadas a distancias distintas.
    """
    jaw = [forward(points[i]) for i in JAW]
    chin_y = max(y for _, y in jaw)
    e = PORTRAIT_EYE_SPAN

    cx = SIZE / 2
    cy = PORTRAIT_EYE_Y + 0.55 * e
    rx = 2.10 * e
    ry = max(2.55 * e, (chin_y - cy) + 1.5 * e)

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    return mask.filter(ImageFilter.GaussianBlur(feather))


def extend_edges(face: Image.Image, mask: Image.Image) -> Image.Image:
    """
    Rellena todo lo que rodea al rostro estirando la piel del borde hacia afuera.

    Es el paso que más cambia el resultado. Alrededor de la cara la textura tiene
    que seguir siendo cabeza —ahí la mejilla dobla hacia la oreja y la frente
    hacia la coronilla—, así que dejarla transparente marca un aro donde termina
    la foto, y rellenarla de un color plano marca un escalón: de un lado la piel
    con su sombra y su brillo, del otro una plancha lisa.

    Estirar el borde no marca ninguno de los dos. Cada tono sale hacia afuera por
    donde estaba, así que la sombra del costado sigue siendo sombra al doblar y
    la frente iluminada sigue clara: el rostro se funde con el resto de la cabeza
    sin que haya un punto donde se vea que empieza otra cosa.

    El relleno se hace con una pirámide (el método clásico de empujar y tirar):
    se baja la imagen a la mitad una y otra vez promediando sólo lo que tiene
    piel, hasta que en el nivel más chico no queda ningún hueco; después se sube
    otra vez, y en cada escalón los huecos se completan con el nivel de arriba,
    que ya está lleno. Difundir hacia afuera píxel por píxel daría lo mismo pero
    tarda cientos de pasadas; así son nueve.
    """
    rgb = np.array(face.convert("RGB"), dtype=np.float32) / 255.0
    alpha = np.array(mask, dtype=np.float32)[:, :, None] / 255.0

    # Bajada: en cada nivel el color va premultiplicado por su peso, así los
    # píxeles que son mitad fondo pesan la mitad y no ensucian el promedio.
    pyramid = [(rgb * alpha, alpha)]
    while pyramid[-1][1].shape[0] > 2:
        c, a = pyramid[-1]
        h, w = (c.shape[0] // 2) * 2, (c.shape[1] // 2) * 2
        c = c[:h, :w].reshape(h // 2, 2, w // 2, 2, 3).sum(axis=(1, 3))
        a = a[:h, :w].reshape(h // 2, 2, w // 2, 2, 1).sum(axis=(1, 3))
        pyramid.append((c / 4.0, a / 4.0))

    # Subida: cada nivel se completa con el de arriba, ya sin huecos.
    c, a = pyramid[-1]
    filled = c / np.maximum(a, 1e-4)
    for level in range(len(pyramid) - 2, -1, -1):
        c, a = pyramid[level]
        up = np.array(
            Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8))
            .resize((c.shape[1], c.shape[0]), Image.BILINEAR),
            dtype=np.float32,
        ) / 255.0
        w = np.clip(a, 0, 1)
        filled = (c / np.maximum(a, 1e-4)) * w + up * (1 - w)

    plate = np.clip(filled, 0, 1)

    # Y por último, la lámina se apaga hacia un tono liso en los bordes.
    #
    # El estirado resuelve el interior pero no el final: la foto trae su propia
    # luz horneada —de dónde venía la lámpara ese día— y el cráneo 3D recibe la
    # luz de la pista. Donde termina el casquete y sigue el cráneo, esas dos
    # luces se encuentran y se ve el escalón, por más que los colores medios
    # coincidan. Si en cambio la lámina llega al borde convertida en un color
    # plano, y el cráneo se pinta exactamente de ese color, las dos superficies
    # llegan iguales al encuentro y no hay dónde ver la junta.
    #
    # El peso sale de la propia máscara muy desenfocada: vale 1 sobre el rostro,
    # que queda intacto, y se va apagando hacia afuera.
    weight = np.array(
        mask.filter(ImageFilter.GaussianBlur(SIZE * 0.17)), dtype=np.float32
    )[:, :, None] / 255.0
    weight = np.clip(weight * 1.9, 0, 1)

    border = np.concatenate([plate[:2].reshape(-1, 3), plate[-2:].reshape(-1, 3),
                             plate[:, :2].reshape(-1, 3), plate[:, -2:].reshape(-1, 3)])
    flat = np.median(border, axis=0)[None, None, :]

    plate = plate * weight + flat * (1 - weight)
    return Image.fromarray((np.clip(plate, 0, 1) * 255).astype(np.uint8))


def graded(img: Image.Image, cid: str, sharpen: float) -> Image.Image:
    """Realce suave: las fotos de celular se ven apagadas junto al 3D saturado.

    `sharpen` compensa el estirado: la foto de Isa es de cuerpo entero y su cara
    entra con menos de la mitad de píxeles que las demás, así que al escalarla
    llega blanda y necesita más máscara de enfoque que el resto.
    """
    if sharpen > 0:
        img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=int(sharpen), threshold=3))
    img = ImageEnhance.Color(img).enhance(1.10)
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Brightness(img).enhance(1.04 * TONE.get(cid, 1.0))
    return img


def plate_skin(plate: Image.Image, band: int = 56):
    """
    Con qué color hay que pintar el resto de la cabeza 3D.

    La textura de la cara cubre el frente del cráneo; del borde para atrás sigue
    el material liso del modelo. Si ese material no es exactamente el color al
    que llega la textura en su borde, se ve el escalón — y se ve muchísimo,
    porque cae justo sobre la sien, que es donde el ojo va a buscar la silueta.

    Así que el color no se saca de la mejilla ni del promedio de la foto, sino
    del BORDE de la lámina ya terminada: literalmente el último color que se ve
    antes de que empiece el cráneo. Con la mediana y no el promedio, para que un
    brillo suelto en una esquina no arrastre el tono de toda la cabeza.
    """
    px = np.array(plate.convert("RGB"))
    frame = np.concatenate([
        px[:band].reshape(-1, 3), px[-band:].reshape(-1, 3),
        px[:, :band].reshape(-1, 3), px[:, -band:].reshape(-1, 3),
    ])
    r, g, b = (int(v) for v in np.median(frame, axis=0))
    return (r, g, b), f"0x{r:02x}{g:02x}{b:02x}"


def encode(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=88, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> None:
    with open("scripts/landmarks.json") as fh:
        marks = json.load(fh)

    faces, portraits, skins = {}, {}, {}
    sheet_face, sheet_portrait = [], []

    # --- Primera pasada: medir las seis ---------------------------------------
    # La forma a la que va cada cara depende del promedio de las seis, así que
    # primero hay que tenerlas todas medidas. No se puede procesar una y seguir.
    measured = {}
    for cid, info in marks.items():
        eyes = (info["leftEye"], info["rightEye"])
        coeffs, forward = transform_for(eyes, FACE_EYE_Y, FACE_EYE_SPAN)
        measured[cid] = {
            "photo": Image.open(f"fotos/{cid}.jpg").convert("RGB"),
            "eyes": eyes,
            "coeffs": coeffs,
            "forward": forward,
            "shape": np.array([forward(p) for p in info["points"]], dtype=np.float64),
        }

    aims = frontalize.targets({cid: m["shape"] for cid, m in measured.items()})

    # --- Segunda pasada: enderezar y construir --------------------------------
    for cid, m in measured.items():
        eyes = m["eyes"]

        # Cuánto hay que estirar esta foto para llegar a la textura: por encima
        # de 2x la cara llega blanda y hay que enfocarla más.
        span = math.hypot(eyes[1][0] - eyes[0][0], eyes[1][1] - eyes[0][1])
        stretch = FACE_EYE_SPAN / span
        sharpen = min(150, max(0, (stretch - 1.15) * 130))

        # La foto se deforma para llevar la cara al frente y a la geometría común.
        # A partir de acá los landmarks buenos son los de destino, no los medidos:
        # la máscara y todo lo demás se calculan sobre la cara ya enderezada.
        aim = aims[cid]
        axis = frontalize.face_axis(m["shape"])
        straight = frontalize.warp(
            np.array(aligned(m["photo"], m["coeffs"])), m["shape"], aim,
        )

        # En las caras muy giradas, la mitad que la foto no muestra se completa
        # con su reflejo. Sin esto el warp estira hacia ahí lo que había detrás
        # de la cabeza: en Benja el local del fondo, en Vero el respaldo del auto.
        turn = frontalize.asymmetry(m["shape"], axis, FACE_EYE_SPAN)
        fill = min(1.0, max(0.0, (turn - 0.035) * 6.5))
        aim_axis = frontalize.face_axis(aim)
        straight, mirror_w = frontalize.mirror_fill(
            straight, fill, frontalize.hidden_side(m["shape"], axis), aim_axis,
            start=FACE_EYE_SPAN * 0.80, full=FACE_EYE_SPAN * 1.40,
        )
        face = even_lighting(Image.fromarray(straight))

        # Dónde hay CARA de verdad después de enderezar.
        #
        # El contorno de destino es más ancho que el medido —reconstruye la
        # mitad que la foto escondía— así que la máscara, calculada sobre él,
        # pide píxeles que en la foto original eran pared, ropa o el local del
        # fondo. En la lámina plana no se notaba; sobre la cabeza, a Benja le
        # quedaba el fondo del local pegado en la sien.
        #
        # Se resuelve pasando por el mismo warp una mancha blanca con el
        # contorno MEDIDO: lo que llega blanco es lo que era cara. Donde el
        # espejo ya rellenó vale también el reflejo, porque ahí el píxel salió
        # del otro lado de la misma cara. Lo que queda afuera no se descarta:
        # lo completa después el estirado de la piel del borde, que para eso
        # está.
        real = np.array(contour_mask(m["shape"], IDENTITY, inset=14, feather=5))
        valid = frontalize.warp(
            np.dstack([real] * 3), m["shape"], aim,
        )[:, :, 0].astype(np.float32)
        if fill > 0.4:
            reflected = frontalize.mirror_about(valid[:, :, None], aim_axis)[:, :, 0]
            valid = np.where((mirror_w > 0.55)[None, :], np.maximum(valid, reflected), valid)

        mask = np.minimum(
            np.array(contour_mask(aim, IDENTITY), dtype=np.float32), valid)
        mask = Image.fromarray(mask.astype(np.uint8)).filter(ImageFilter.GaussianBlur(7))

        face = graded(balance(face, mask), cid, sharpen)

        plate = extend_edges(face, mask)
        _, skin_hex = plate_skin(plate)
        skins[cid] = skin_hex
        faces[cid] = encode(plate)
        sheet_face.append(plate)

        points = marks[cid]["points"]
        p_coeffs, p_forward = transform_for(eyes, PORTRAIT_EYE_Y, PORTRAIT_EYE_SPAN)
        portrait = aligned(m["photo"], p_coeffs)
        # El balance se mide sobre la piel, nunca sobre el retrato entero: con el
        # fondo adentro, una pared clara o el pasto correrían toda la corrección.
        portrait = graded(
            balance(portrait, jaw_mask(points, p_forward)), cid, sharpen * 0.5
        ).convert("RGBA")
        portrait.putalpha(portrait_mask(points, p_forward))
        portraits[cid] = encode(portrait)
        sheet_portrait.append(portrait)

        print(f"{cid}: piel {skin_hex}  estiro {stretch:.2f}x  enfoque {sharpen:.0f}  "
              f"giro {turn:.3f} → espejo {fill:.2f}  cara {len(faces[cid]) // 1024} KB  "
              f"retrato {len(portraits[cid]) // 1024} KB")

    header = '''/**
 * Fotos de los pilotos, ya recortadas y alineadas.
 *
 * Generado por `scripts/build-photos.py` a partir de `fotos/` y de los 68
 * landmarks que deja `scripts/landmarks.py`. No editar a mano.
 *
 * Van embebidas en base64 y no como archivos sueltos porque el juego se publica
 * como un único HTML: un `<img src="...">` a un archivo que no existe dejaría a
 * los personajes sin cara.
 *
 * - `FACE_PHOTOS`    reemplaza la cara dibujada sobre el casquete del modelo 3D.
 *   Está alineada por las pupilas y recortada por el contorno real de la cara.
 * - `PORTRAIT_PHOTOS` es el recorte con pelo y hombros de la presentación y del
 *   menú.
 * - `PHOTO_SKIN` es el tono de la piel en el BORDE del recorte de cada foto: con
 *   él se tiñe la cabeza 3D, para que donde termina la foto y empieza la piel
 *   del modelo no se vea el escalón.
 */

'''
    with open("src/characters/photos.ts", "w") as fh:
        fh.write(header)
        fh.write(f"export const FACE_PHOTOS: Record<string, string> = {json.dumps(faces, indent=2)};\n\n")
        fh.write(f"export const PORTRAIT_PHOTOS: Record<string, string> = {json.dumps(portraits, indent=2)};\n\n")
        fh.write("export const PHOTO_SKIN: Record<string, number> = {\n")
        for cid, hexv in skins.items():
            fh.write(f"  {cid}: {hexv},\n")
        fh.write("};\n")

    print("src/characters/photos.ts escrito")

    scratch = os.environ.get("SCRATCH")
    if scratch:
        for name, tiles, bg in (("caras", sheet_face, (30, 30, 30)),
                                ("retratos", sheet_portrait, (30, 30, 30))):
            w = sum(t.width for t in tiles)
            board = Image.new("RGB", (w, SIZE), bg)
            x = 0
            for t in tiles:
                board.paste(t, (x, 0), t if t.mode == "RGBA" else None)
                x += t.width
            board.save(f"{scratch}/{name}.png")
        print(f"hojas de control en {scratch}")


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(__file__), ".."))
    main()
