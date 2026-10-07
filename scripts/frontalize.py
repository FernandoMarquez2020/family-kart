#!/usr/bin/env python3
"""
Endereza las caras y las lleva a una geometría común.

El problema que resuelve: las seis fotos están sacadas con la cabeza en seis
posiciones distintas. Benja mira hacia abajo y a un costado, Vero está apoyada
en la mano con la cabeza inclinada, Isa tiene el mentón levantado. Alinear por
las pupilas arregla la rotación en el plano —la inclinación— pero no toca el
GIRO: una cara de tres cuartos sigue siendo de tres cuartos por más que se la
enderece, y puesta sobre una cabeza que mira al frente se lee torcida.

La idea, en dos pasos:

1. **Simetrizar endereza.** Una cara de frente es casi simétrica; una girada no.
   Si se promedia el contorno medido con su propio espejo, lo que sobra de un
   lado y falta del otro se compensa, y lo que queda es esa misma cara mirando
   al frente. No hace falta estimar el ángulo ni un modelo 3D de la cabeza: el
   espejo ya trae la información que falta.

2. **Mezclar con la forma media homogeneiza.** Con las seis ya de frente, se
   promedian sus formas y cada una se lleva un poco hacia ese promedio. Después
   de eso, los seis tienen los ojos, la nariz y la boca en el mismo lugar — que
   es lo que hace que se vean como personajes de un mismo juego y no como seis
   fotos distintas. Se va sólo una parte del camino: llevándolas del todo al
   promedio los seis terminan con la misma cara, y la gracia era justamente que
   se reconozcan.

La foto se deforma con un warp por triángulos (Delaunay sobre los puntos): cada
triangulito se estira por su cuenta con una transformación afín. Un warp global
no sirve —no puede mover la nariz sin mover las orejas— y uno suave tipo
thin-plate cuesta mucho más para el mismo resultado a este tamaño.
"""

import numpy as np

# Qué punto es el espejo de cuál, en el esquema de 68 de dlib.
FLIP = np.array([
    16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,      # mandíbula
    26, 25, 24, 23, 22, 21, 20, 19, 18, 17,                        # cejas
    27, 28, 29, 30,                                                # puente de la nariz
    35, 34, 33, 32, 31,                                            # base de la nariz
    45, 44, 43, 42, 47, 46,                                        # ojo derecho → izquierdo
    39, 38, 37, 36, 41, 40,                                        # ojo izquierdo → derecho
    54, 53, 52, 51, 50, 49, 48, 59, 58, 57, 56, 55,                # boca, contorno
    64, 63, 62, 61, 60, 67, 66, 65,                                # boca, interior
])


def symmetrize(pts: np.ndarray, axis_x: float) -> np.ndarray:
    """
    La misma cara, mirando al frente.

    Cada punto se cruza con el reflejo de su punto espejo. En vertical se
    promedian, pero en horizontal se toma el que está MÁS LEJOS del eje, y ahí
    está el detalle que importa.

    Promediando, una cara girada sale angosta. El lado que se aleja de la cámara
    está escorzado —se ve más corto de lo que es— y promediarlo con el lado
    cercano, que sí está a su ancho real, da un ancho intermedio que no es el de
    nadie. Aplicado a las seis, además, arrastra el promedio general y terminan
    todas más flacas de lo que son. Quedándose con el más lejano al eje se
    reconstruye la cara al ancho del lado que se ve bien, que es el que no está
    deformado por la perspectiva.
    """
    mirrored = pts[FLIP].copy()
    mirrored[:, 0] = 2 * axis_x - mirrored[:, 0]

    own = pts[:, 0] - axis_x
    other = mirrored[:, 0] - axis_x
    # El más alejado del eje, conservando de qué lado está cada punto.
    width = np.maximum(np.abs(own), np.abs(other))
    side = np.sign(np.where(np.abs(own) >= np.abs(other), own, other))

    out = np.empty_like(pts)
    out[:, 0] = axis_x + width * side
    out[:, 1] = (pts[:, 1] + mirrored[:, 1]) / 2
    return out


def asymmetry(pts: np.ndarray, axis_x: float, eye_span: float) -> float:
    """
    Cuánto está girada esta cabeza, en fracción de la separación entre ojos.

    No es el ángulo: es cuánto se despega la cara medida de su propio espejo, que
    para lo que hace falta acá alcanza y no necesita un modelo 3D de la cabeza.
    """
    mirrored = pts[FLIP].copy()
    mirrored[:, 0] = 2 * axis_x - mirrored[:, 0]
    return float(np.abs(pts - mirrored).mean() / eye_span)


def hidden_side(pts: np.ndarray, axis_x: float) -> int:
    """
    De qué lado de la imagen quedó la mitad de cara que la foto casi no muestra.

    Es el lado más angosto: en una cara girada, la mejilla que se aleja aparece
    comprimida contra el eje. Devuelve -1 si es la izquierda de la imagen, +1 si
    es la derecha.
    """
    jaw = pts[:17, 0] - axis_x
    left = -jaw[jaw < 0].min() if (jaw < 0).any() else 0.0
    right = jaw[jaw > 0].max() if (jaw > 0).any() else 0.0
    return -1 if left < right else 1


def face_axis(pts: np.ndarray) -> float:
    """
    El eje vertical de la cara.

    No es el centro de la imagen ni el promedio de todos los puntos: los dos se
    corren en una cara girada, justamente porque hay más cara de un lado. Se usa
    la línea que une el entrecejo con la base de la nariz y el mentón, que son
    puntos del plano medio y por lo tanto están sobre el eje mirés desde donde
    mirés.
    """
    midline = pts[[27, 28, 29, 30, 33, 51, 57, 8]]
    return float(midline[:, 0].mean())


def targets(shapes: dict, individuality: float = 0.62) -> dict:
    """
    A qué forma tiene que ir cada cara.

    `individuality` gradúa cuánto se conserva de cada uno. En 1 cada cara queda
    sólo enderezada y las seis siguen teniendo proporciones distintas; en 0 los
    seis terminan con la misma cara. El valor por defecto endereza, empareja lo
    suficiente como para que se lean parejos, y deja a cada uno con su mentón y
    su separación de ojos.
    """
    sym = {cid: symmetrize(p, face_axis(p)) for cid, p in shapes.items()}
    mean = np.mean(list(sym.values()), axis=0)
    return {cid: mean + (s - mean) * individuality for cid, s in sym.items()}


def mirror_fill(img, strength: float, side: int, axis_x: float,
                start: float = 112.0, full: float = 210.0):
    """
    Rellena con el reflejo la mitad de cara que la foto no llegó a mostrar.

    Enderezar una cara girada pide una mitad que en la foto no está: detrás de la
    nariz y del pómulo hay fondo, no mejilla. El warp la estira igual, y lo que
    entra es lo que había ahí — en la de Benja, el local de atrás; en la de Vero,
    el respaldo del auto. Se ve como una mancha de color pegada al ojo.

    Como la cara ya se llevó a una forma simétrica, la mitad que falta es el
    espejo de la que sobra, y eso es exactamente lo que se copia. Se copia sólo
    del lado escondido: el lado bueno no se toca, que es lo que evita que la cara
    termine pareciendo un calco simétrico.

    La mezcla no arranca en el eje sino BIEN AFUERA, pasado el ojo (`start`). Es
    la diferencia entre que esto funcione o arruine la cara: empezando en el eje,
    el ojo bueno se superpone al de este lado con un 20 o 30 por ciento y queda
    un ojo fantasma, doble y desenfocado. Desde el ojo hacia afuera no hay ningún
    rasgo que duplicar —es mejilla, sien y mandíbula— y ahí el reflejo pasa
    inadvertido, que es justo donde hace falta porque es lo que la foto no tenía.

    `strength` sale del giro medido: en una cara de frente da cero y esto no
    hace nada.
    """
    if strength <= 0.01:
        return img, np.zeros(img.shape[1], dtype=np.float32)

    h, w = img.shape[:2]
    xs = np.arange(w, dtype=np.float32)
    # Distancia al eje hacia el lado escondido, en píxeles.
    out_x = (xs - axis_x) * side
    reach = np.clip((out_x - start) / max(1.0, full - start), 0, 1)
    # Curva suave: sin esto se ve la línea donde arranca la mezcla.
    weight = (reach * reach * (3 - 2 * reach) * strength)[None, :, None]

    out = img.astype(np.float32) * (1 - weight) + mirror_about(img, axis_x).astype(np.float32) * weight
    return np.clip(out, 0, 255).astype(img.dtype), weight[0, :, 0]


def mirror_about(img, axis_x: float):
    """Refleja la imagen alrededor del eje de la CARA, no del centro del cuadro.

    Reflejar sin corregir deja la copia corrida: `img[:, ::-1]` es simétrica
    respecto del centro de la imagen, y el eje de la cara casi nunca cae ahí.
    """
    w = img.shape[1]
    flipped = np.ascontiguousarray(img[:, ::-1])
    shift = int(round(2 * axis_x - (w - 1)))
    return np.roll(flipped, shift, axis=1) if shift else flipped


def _anchors(pts: np.ndarray, size: int, spread: float) -> np.ndarray:
    """
    Puntos de sujeción alrededor de la cara.

    El warp sólo sabe mover lo que está dentro de la malla de triángulos, así
    que sin esto la frente, las sienes y el cuello se quedarían quietos mientras
    la cara se mueve por debajo, y en la juntura se vería el corte. El anillo
    acompaña a la cara —se calcula por fuera del contorno, desde el centro— y el
    borde de la imagen queda fijo: entre los dos, la deformación se va apagando
    sola.
    """
    outline = pts[list(range(17)) + [17, 19, 21, 22, 24, 26]]
    center = outline.mean(axis=0)
    ring = center + (outline - center) * spread

    e = size - 1
    border = np.array([
        [0, 0], [e / 2, 0], [e, 0],
        [0, e / 2], [e, e / 2],
        [0, e], [e / 2, e], [e, e],
    ], dtype=np.float64)
    return np.vstack([ring, border])


def warp(img, src: np.ndarray, dst: np.ndarray, spread: float = 1.42):
    """
    Deforma la imagen llevando cada punto de `src` a su lugar en `dst`.

    Se triangula sobre los puntos de DESTINO y no sobre los de origen: así cada
    píxel de salida cae en exactamente un triángulo y se sabe de dónde traerlo.
    Triangulando el origen habría zonas de la imagen final sin cubrir y otras
    cubiertas dos veces, que es como aparecen las costuras.
    """
    import cv2

    size = img.shape[0]
    src_all = np.vstack([src, _anchors(src, size, spread)]).astype(np.float32)
    dst_all = np.vstack([dst, _anchors(dst, size, spread)]).astype(np.float32)

    # Los anclajes salen de cada forma por separado, pero el borde de la imagen
    # tiene que ser el mismo en las dos o la imagen se estiraría contra el marco.
    src_all[-8:] = dst_all[-8:]

    inside = np.clip(dst_all, 0, size - 1).astype(np.float64)
    subdiv = cv2.Subdiv2D((0, 0, size, size))
    for x, y in inside:
        subdiv.insert((float(x), float(y)))

    out = np.zeros_like(img)
    for t in subdiv.getTriangleList():
        corners = np.array([[t[i], t[i + 1]] for i in (0, 2, 4)], dtype=np.float64)

        # Los vértices se buscan por CERCANÍA y no por igualdad. `Subdiv2D`
        # guarda los puntos con su propia precisión y los devuelve con una
        # diferencia de milésimas: comparando por clave exacta no coincide
        # ninguno y la imagen sale entera en negro, sin ningún error.
        dist = np.linalg.norm(inside[None, :, :] - corners[:, None, :], axis=2)
        ids = dist.argmin(axis=1)
        if dist[np.arange(3), ids].max() > 1.0:
            continue  # los vértices del súper-triángulo que agrega Subdiv2D
        if len(set(ids.tolist())) < 3:
            continue

        tri_dst = dst_all[ids].astype(np.float32)
        tri_src = src_all[ids].astype(np.float32)

        # Se trabaja sólo sobre la caja del triángulo: recorrer la imagen entera
        # una vez por triángulo serían más de ciento cincuenta pasadas.
        x, y, w, h = cv2.boundingRect(tri_dst)
        if w <= 0 or h <= 0:
            continue
        offset_dst = (tri_dst - [x, y]).astype(np.float32)

        # El origen se lee de la imagen ENTERA y no de un recorte. El anillo de
        # sujeción queda por fuera del contorno de la cara, así que sus
        # triángulos tienen vértices fuera del cuadro; recortando por su caja,
        # tarde o temprano toca una de ancho o alto cero y revienta.
        matrix = cv2.getAffineTransform(tri_src, offset_dst)
        patch = cv2.warpAffine(
            img, matrix, (w, h),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101,
        )

        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.int32(offset_dst), 255, cv2.LINE_AA)

        # La caja del triángulo puede asomarse fuera del cuadro —los triángulos
        # del anillo de sujeción llegan hasta el borde—, así que se recorta a la
        # imagen antes de pegar. Sin esto, la rebanada de destino sale de ancho
        # cero y el pegado falla.
        x0, y0 = max(x, 0), max(y, 0)
        x1, y1 = min(x + w, size), min(y + h, size)
        if x1 <= x0 or y1 <= y0:
            continue
        sub = (slice(y0 - y, y1 - y), slice(x0 - x, x1 - x))
        np.copyto(out[y0:y1, x0:x1], patch[sub], where=mask[sub][:, :, None] > 0)

    return out
